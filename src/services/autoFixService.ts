import { exec, execSync, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface CodeChange {
  /** File path relative to the worktree root */
  filePath: string;
  /** The content to write to the file, or null to delete the file */
  content: string | null;
  /** Original content for rollback purposes (populated during apply) */
  originalContent?: string | null;
}

export interface Fix {
  /** Unique identifier for this fix */
  id: string;
  /** The task ID this fix belongs to */
  taskId: string;
  /** The branch name for this task */
  branchName: string;
  /** Path to the worktree directory */
  worktreePath: string;
  /** Commit message for the fix */
  commitMessage: string;
  /** Code changes to apply */
  changes: CodeChange[];
}

export type FixStatus = 'applied' | 'failed' | 'conflict';

export interface FixResult {
  fixId: string;
  taskId: string;
  status: FixStatus;
  commitHash?: string;
  error?: string;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface AutoFixConfig {
  /** Timeout for git operations in milliseconds */
  gitTimeout: number;
  /** Timeout for validation commands in milliseconds */
  validationTimeout: number;
  /** Whether to run linter validation */
  runLinter: boolean;
  /** Whether to run TypeScript compiler validation */
  runTypeCheck: boolean;
  /** Custom linter command (defaults to npm run lint) */
  linterCommand?: string;
  /** Custom type check command (defaults to npx tsc --noEmit) */
  typeCheckCommand?: string;
}

const DEFAULT_CONFIG: AutoFixConfig = {
  gitTimeout: 30000,
  validationTimeout: 60000,
  runLinter: false,
  runTypeCheck: false,
};

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Execute a git command safely with timeout and error handling
 */
async function execGit(
  command: string,
  cwd: string,
  timeout: number = 30000
): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
      signal?: string;
    };

    if (execError.killed || execError.signal === 'SIGTERM') {
      throw new Error(`Git command timed out after ${timeout}ms: git ${command}`);
    }

    return {
      stdout: execError.stdout?.trim() || '',
      stderr: execError.stderr?.trim() || '',
      exitCode: execError.code || 1,
    };
  }
}

/**
 * Check if a path is a valid git worktree
 */
async function isValidWorktree(worktreePath: string): Promise<boolean> {
  try {
    const result = await execGit('rev-parse --is-inside-work-tree', worktreePath);
    return result.stdout === 'true';
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(worktreePath: string): Promise<string> {
  const result = await execGit('rev-parse --abbrev-ref HEAD', worktreePath);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get current branch: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Check if there are uncommitted changes in the worktree
 */
async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  const result = await execGit('status --porcelain', worktreePath);
  return result.stdout.length > 0;
}

/**
 * Check if there are merge conflicts
 */
async function hasMergeConflicts(worktreePath: string): Promise<boolean> {
  const result = await execGit('diff --name-only --diff-filter=U', worktreePath);
  return result.stdout.length > 0;
}

/**
 * Checkout a branch in the worktree
 */
async function checkoutBranch(
  worktreePath: string,
  branchName: string,
  timeout: number
): Promise<void> {
  const result = await execGit(`checkout ${branchName}`, worktreePath, timeout);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to checkout branch ${branchName}: ${result.stderr}`);
  }
}

/**
 * Stage all changes
 */
async function stageChanges(
  worktreePath: string,
  filePaths: string[],
  timeout: number
): Promise<void> {
  for (const filePath of filePaths) {
    const fullPath = path.join(worktreePath, filePath);
    if (fs.existsSync(fullPath)) {
      const result = await execGit(`add "${filePath}"`, worktreePath, timeout);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to stage ${filePath}: ${result.stderr}`);
      }
    } else {
      // File was deleted, stage the deletion
      const result = await execGit(`rm --cached "${filePath}"`, worktreePath, timeout);
      if (result.exitCode !== 0 && !result.stderr.includes('did not match any files')) {
        throw new Error(`Failed to stage deletion of ${filePath}: ${result.stderr}`);
      }
    }
  }
}

/**
 * Create a commit with the staged changes
 */
async function createCommit(
  worktreePath: string,
  message: string,
  timeout: number
): Promise<string> {
  // Escape double quotes in the message
  const escapedMessage = message.replace(/"/g, '\\"');
  const result = await execGit(`commit -m "${escapedMessage}"`, worktreePath, timeout);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create commit: ${result.stderr}`);
  }

  // Get the commit hash
  const hashResult = await execGit('rev-parse HEAD', worktreePath, timeout);
  if (hashResult.exitCode !== 0) {
    throw new Error(`Failed to get commit hash: ${hashResult.stderr}`);
  }

  return hashResult.stdout;
}

/**
 * Reset the worktree to a specific commit
 */
async function resetToCommit(
  worktreePath: string,
  commitHash: string,
  hard: boolean,
  timeout: number
): Promise<void> {
  const mode = hard ? '--hard' : '--soft';
  const result = await execGit(`reset ${mode} ${commitHash}`, worktreePath, timeout);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to reset to ${commitHash}: ${result.stderr}`);
  }
}

/**
 * Abort any in-progress merge
 */
async function abortMerge(worktreePath: string, timeout: number): Promise<void> {
  const result = await execGit('merge --abort', worktreePath, timeout);
  // Ignore errors if there's no merge in progress
  if (result.exitCode !== 0 && !result.stderr.includes('There is no merge')) {
    throw new Error(`Failed to abort merge: ${result.stderr}`);
  }
}

/**
 * Abort any in-progress rebase
 */
async function abortRebase(worktreePath: string, timeout: number): Promise<void> {
  const result = await execGit('rebase --abort', worktreePath, timeout);
  // Ignore errors if there's no rebase in progress
  if (result.exitCode !== 0 && !result.stderr.includes('No rebase')) {
    throw new Error(`Failed to abort rebase: ${result.stderr}`);
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read file content, returning null if file doesn't exist
 */
function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write content to a file, creating directories as needed
 */
function writeFileContent(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Delete a file if it exists
 */
function deleteFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Apply code changes to files in the worktree
 * Returns the changes with original content populated for rollback
 */
function applyCodeChanges(
  worktreePath: string,
  changes: CodeChange[]
): CodeChange[] {
  const appliedChanges: CodeChange[] = [];

  for (const change of changes) {
    const fullPath = path.join(worktreePath, change.filePath);
    const originalContent = readFileContent(fullPath);

    if (change.content === null) {
      // Delete the file
      deleteFile(fullPath);
    } else {
      // Write the new content
      writeFileContent(fullPath, change.content);
    }

    appliedChanges.push({
      ...change,
      originalContent,
    });
  }

  return appliedChanges;
}

/**
 * Rollback code changes using stored original content
 */
function rollbackCodeChanges(
  worktreePath: string,
  changes: CodeChange[]
): void {
  for (const change of changes) {
    const fullPath = path.join(worktreePath, change.filePath);

    if (change.originalContent === null || change.originalContent === undefined) {
      // File didn't exist before, delete it
      deleteFile(fullPath);
    } else {
      // Restore original content
      writeFileContent(fullPath, change.originalContent);
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Run a validation command and capture output
 */
async function runValidationCommand(
  command: string,
  cwd: string,
  timeout: number
): Promise<ValidationResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      success: true,
      errors: [],
      warnings: stderr ? stderr.split('\n').filter(Boolean) : [],
    };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
    };

    if (execError.killed) {
      return {
        success: false,
        errors: [`Validation timed out after ${timeout}ms`],
        warnings: [],
      };
    }

    const errorOutput = execError.stderr || execError.stdout || 'Unknown error';
    return {
      success: false,
      errors: errorOutput.split('\n').filter(Boolean),
      warnings: [],
    };
  }
}

/**
 * Validate the changes using configured validators
 */
async function validateChanges(
  worktreePath: string,
  config: AutoFixConfig
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.runLinter) {
    const linterCommand = config.linterCommand || 'npm run lint';
    const lintResult = await runValidationCommand(
      linterCommand,
      worktreePath,
      config.validationTimeout
    );

    if (!lintResult.success) {
      errors.push(...lintResult.errors.map((e) => `Linter: ${e}`));
    }
    warnings.push(...lintResult.warnings.map((w) => `Linter: ${w}`));
  }

  if (config.runTypeCheck) {
    const typeCheckCommand = config.typeCheckCommand || 'npx tsc --noEmit';
    const typeResult = await runValidationCommand(
      typeCheckCommand,
      worktreePath,
      config.validationTimeout
    );

    if (!typeResult.success) {
      errors.push(...typeResult.errors.map((e) => `TypeCheck: ${e}`));
    }
    warnings.push(...typeResult.warnings.map((w) => `TypeCheck: ${w}`));
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Main Service
// ============================================================================

/**
 * Apply a single fix to a task branch
 */
async function applySingleFix(
  fix: Fix,
  config: AutoFixConfig
): Promise<FixResult> {
  const { id: fixId, taskId, branchName, worktreePath, commitMessage, changes } = fix;

  let appliedChanges: CodeChange[] = [];
  let originalBranch: string | null = null;
  let preCommitHash: string | null = null;

  try {
    // Validate worktree
    if (!(await isValidWorktree(worktreePath))) {
      return {
        fixId,
        taskId,
        status: 'failed',
        error: `Invalid worktree path: ${worktreePath}`,
      };
    }

    // Check for existing conflicts
    if (await hasMergeConflicts(worktreePath)) {
      return {
        fixId,
        taskId,
        status: 'conflict',
        error: 'Worktree has existing merge conflicts that must be resolved first',
      };
    }

    // Store current branch for potential rollback
    originalBranch = await getCurrentBranch(worktreePath);

    // Checkout target branch if different
    if (originalBranch !== branchName) {
      // Check for uncommitted changes before switching
      if (await hasUncommittedChanges(worktreePath)) {
        return {
          fixId,
          taskId,
          status: 'failed',
          error: 'Worktree has uncommitted changes. Please commit or stash them first.',
        };
      }

      await checkoutBranch(worktreePath, branchName, config.gitTimeout);
    }

    // Store current commit hash for rollback
    const hashResult = await execGit('rev-parse HEAD', worktreePath, config.gitTimeout);
    preCommitHash = hashResult.stdout;

    // Apply code changes
    appliedChanges = applyCodeChanges(worktreePath, changes);

    // Validate changes if configured
    if (config.runLinter || config.runTypeCheck) {
      const validationResult = await validateChanges(worktreePath, config);

      if (!validationResult.success) {
        // Rollback file changes
        rollbackCodeChanges(worktreePath, appliedChanges);

        return {
          fixId,
          taskId,
          status: 'failed',
          error: `Validation failed:\n${validationResult.errors.join('\n')}`,
        };
      }
    }

    // Stage changes
    const filePaths = changes.map((c) => c.filePath);
    await stageChanges(worktreePath, filePaths, config.gitTimeout);

    // Check if there are actually changes to commit
    if (!(await hasUncommittedChanges(worktreePath))) {
      return {
        fixId,
        taskId,
        status: 'failed',
        error: 'No changes to commit after applying fix',
      };
    }

    // Create commit
    const commitHash = await createCommit(worktreePath, commitMessage, config.gitTimeout);

    return {
      fixId,
      taskId,
      status: 'applied',
      commitHash,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Attempt rollback
    try {
      if (appliedChanges.length > 0) {
        rollbackCodeChanges(worktreePath, appliedChanges);
      }

      if (preCommitHash) {
        await resetToCommit(worktreePath, preCommitHash, true, config.gitTimeout);
      }

      // Clean up any in-progress operations
      await abortMerge(worktreePath, config.gitTimeout).catch(() => {});
      await abortRebase(worktreePath, config.gitTimeout).catch(() => {});
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      return {
        fixId,
        taskId,
        status: 'failed',
        error: `${errorMessage}. Rollback also failed: ${rollbackMessage}`,
      };
    }

    // Check if this was a conflict
    if (
      errorMessage.includes('conflict') ||
      errorMessage.includes('CONFLICT') ||
      errorMessage.includes('Merge conflict')
    ) {
      return {
        fixId,
        taskId,
        status: 'conflict',
        error: errorMessage,
      };
    }

    return {
      fixId,
      taskId,
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Apply multiple fixes to task branches
 *
 * @param fixes - Array of fixes to apply
 * @param config - Optional configuration overrides
 * @returns Array of results for each fix
 */
export async function applyFixes(
  fixes: Fix[],
  config: Partial<AutoFixConfig> = {}
): Promise<FixResult[]> {
  const mergedConfig: AutoFixConfig = { ...DEFAULT_CONFIG, ...config };
  const results: FixResult[] = [];

  // Process fixes sequentially to avoid conflicts
  for (const fix of fixes) {
    const result = await applySingleFix(fix, mergedConfig);
    results.push(result);
  }

  return results;
}

/**
 * Rollback a previously applied fix by resetting to the parent commit
 *
 * @param worktreePath - Path to the worktree
 * @param commitHash - The commit hash of the fix to rollback
 * @param config - Optional configuration overrides
 */
export async function rollbackFix(
  worktreePath: string,
  commitHash: string,
  config: Partial<AutoFixConfig> = {}
): Promise<void> {
  const mergedConfig: AutoFixConfig = { ...DEFAULT_CONFIG, ...config };

  // Verify the commit exists and is HEAD
  const headResult = await execGit('rev-parse HEAD', worktreePath, mergedConfig.gitTimeout);
  if (headResult.stdout !== commitHash) {
    throw new Error(
      `Cannot rollback: commit ${commitHash} is not the current HEAD (${headResult.stdout})`
    );
  }

  // Reset to parent commit
  await resetToCommit(worktreePath, 'HEAD~1', true, mergedConfig.gitTimeout);
}

/**
 * Check if a worktree is in a clean state ready for fixes
 */
export async function checkWorktreeStatus(
  worktreePath: string
): Promise<{
  isValid: boolean;
  currentBranch: string | null;
  hasUncommittedChanges: boolean;
  hasMergeConflicts: boolean;
  error?: string;
}> {
  try {
    const isValid = await isValidWorktree(worktreePath);
    if (!isValid) {
      return {
        isValid: false,
        currentBranch: null,
        hasUncommittedChanges: false,
        hasMergeConflicts: false,
        error: 'Not a valid git worktree',
      };
    }

    const currentBranch = await getCurrentBranch(worktreePath);
    const uncommittedChanges = await hasUncommittedChanges(worktreePath);
    const mergeConflicts = await hasMergeConflicts(worktreePath);

    return {
      isValid: true,
      currentBranch,
      hasUncommittedChanges: uncommittedChanges,
      hasMergeConflicts: mergeConflicts,
    };
  } catch (error) {
    return {
      isValid: false,
      currentBranch: null,
      hasUncommittedChanges: false,
      hasMergeConflicts: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
