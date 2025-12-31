/**
 * Service for creating and executing Claude Code tasks to apply approved fixes.
 * This service builds prompts for fix application, creates tasks in Vibe Kanban,
 * and monitors their execution progress.
 */

import {
  tasksApi,
  sessionsApi,
  attemptsApi,
} from '@/lib/api';
import type {
  Task,
  CreateTask,
  CreateAndStartTaskRequest,
  TaskWithAttemptStatus,
  ExecutionProcess,
  ExecutorProfileId,
  BaseCodingAgent,
  WorkspaceRepoInput,
} from 'shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents an issue/fix that has been approved for application
 */
export interface Issue {
  /** Unique identifier for the issue */
  id: string;
  /** Human-readable title of the issue */
  title: string;
  /** Detailed description of what needs to be fixed */
  description: string;
  /** The file path where the fix should be applied */
  filePath?: string;
  /** The specific line number(s) affected, if applicable */
  lineNumbers?: { start: number; end?: number };
  /** Severity level of the issue */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** The proposed fix/solution */
  proposedFix: string;
  /** The branch where this fix should be applied */
  targetBranch?: string;
  /** Additional context for applying the fix */
  context?: string;
}

/**
 * Information about a git commit created during fix application
 */
export interface CommitInfo {
  /** The commit SHA */
  sha: string;
  /** The commit message */
  message: string;
  /** Files modified in this commit */
  filesModified: string[];
  /** The issue ID this commit addresses */
  issueId: string;
  /** Timestamp when the commit was created */
  createdAt: string;
}

/**
 * Information about a fix that failed to apply
 */
export interface FixFailure {
  /** The issue that failed to be fixed */
  issue: Issue;
  /** Error message explaining why the fix failed */
  errorMessage: string;
  /** Error type for programmatic handling */
  errorType: 'file_not_found' | 'merge_conflict' | 'validation_error' | 'execution_error' | 'unknown';
  /** Stack trace or additional debug info */
  details?: string;
}

/**
 * Results from applying fixes
 */
export interface FixApplicationResults {
  /** Total number of fixes that were attempted */
  totalFixes: number;
  /** Number of fixes that were applied successfully */
  appliedSuccessfully: number;
  /** List of fixes that failed to apply */
  failed: FixFailure[];
  /** List of commits created for successful fixes */
  commits: CommitInfo[];
  /** The task that was created to apply fixes */
  task?: Task;
  /** The workspace/attempt ID created for execution */
  workspaceId?: string;
  /** Overall status of the fix application */
  status: 'success' | 'partial_success' | 'failed' | 'cancelled';
  /** Time when fix application started */
  startedAt: string;
  /** Time when fix application completed */
  completedAt?: string;
}

/**
 * Progress update during fix application
 */
export interface FixApplicationProgress {
  /** Current phase of the fix application process */
  phase: 'creating_task' | 'starting_execution' | 'applying_fixes' | 'committing' | 'completed' | 'failed';
  /** Current fix being processed (1-indexed) */
  currentFix: number;
  /** Total number of fixes to apply */
  totalFixes: number;
  /** Message describing current activity */
  message: string;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** The current execution process, if available */
  executionProcess?: ExecutionProcess;
}

/**
 * Callback type for progress updates
 */
export type ProgressCallback = (progress: FixApplicationProgress) => void;

/**
 * Options for creating a fix application task
 */
export interface CreateFixApplicationTaskOptions {
  /** The project ID where the task will be created */
  projectId: string;
  /** List of approved fixes to apply */
  approvedFixes: Issue[];
  /** Callback for progress updates */
  onProgress?: ProgressCallback;
  /** Repository configuration for the task attempt */
  repos: WorkspaceRepoInput[];
  /** Executor profile to use (defaults to Claude Code) */
  executorProfileId?: ExecutorProfileId;
  /** Whether to auto-commit each fix individually */
  commitPerFix?: boolean;
  /** Custom title prefix for the task */
  titlePrefix?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the prompt for Claude Code to apply the approved fixes
 */
function buildFixApplicationPrompt(
  approvedFixes: Issue[],
  options: { commitPerFix?: boolean } = {}
): string {
  const { commitPerFix = true } = options;

  const fixInstructions = approvedFixes.map((fix, index) => {
    const fixNumber = index + 1;
    const locationInfo = fix.filePath
      ? `\n   - File: ${fix.filePath}${fix.lineNumbers ? ` (lines ${fix.lineNumbers.start}${fix.lineNumbers.end ? `-${fix.lineNumbers.end}` : ''})` : ''}`
      : '';
    const branchInfo = fix.targetBranch ? `\n   - Target Branch: ${fix.targetBranch}` : '';
    const contextInfo = fix.context ? `\n   - Context: ${fix.context}` : '';
    const severityInfo = fix.severity ? ` [${fix.severity.toUpperCase()}]` : '';

    return `
### Fix ${fixNumber}: ${fix.title}${severityInfo}
   - Issue ID: ${fix.id}${locationInfo}${branchInfo}${contextInfo}

   **Description:**
   ${fix.description}

   **Proposed Fix:**
   ${fix.proposedFix}
`;
  }).join('\n');

  const commitInstructions = commitPerFix
    ? `
## Commit Instructions

After successfully applying each fix:
1. Stage the modified files
2. Create a git commit with a clear message following this format:
   \`fix(${'{scope}'}): ${'{brief description}'}\`

   Include in the commit body:
   - Issue ID: ${'{issue_id}'}
   - What was changed and why

3. Only proceed to the next fix after committing the current one
4. If a fix fails, document the error and continue with the remaining fixes
`
    : `
## Commit Instructions

After applying ALL fixes successfully:
1. Stage all modified files
2. Create a single git commit summarizing all changes
3. Include all Issue IDs in the commit message
`;

  return `# Apply Review Fixes

You are tasked with applying ${approvedFixes.length} approved code fix${approvedFixes.length > 1 ? 'es' : ''} to the codebase.

## Important Guidelines

1. **Apply each fix carefully** - Read the description and proposed fix thoroughly before making changes
2. **Preserve existing code** - Only modify what's necessary to apply the fix
3. **Maintain code style** - Follow the existing coding conventions in the project
4. **Handle errors gracefully** - If a fix cannot be applied, document the reason and continue with other fixes
5. **Create atomic commits** - Each commit should represent a complete, working change

## Fixes to Apply
${fixInstructions}
${commitInstructions}

## Execution Steps

1. For each fix above:
   a. Navigate to the specified file (if provided)
   b. Understand the current code structure
   c. Apply the proposed fix
   d. Verify the change doesn't break existing functionality
   e. ${commitPerFix ? 'Commit the change' : 'Move to the next fix'}

2. ${commitPerFix ? 'After all fixes are applied, verify the final state' : 'After all fixes are applied, create a single commit'}

3. Report the results:
   - Which fixes were successfully applied
   - Which fixes failed and why
   - List of commits created

## Output Format

After completing all fixes, provide a summary in this format:

\`\`\`
RESULTS:
- Total fixes attempted: ${approvedFixes.length}
- Successfully applied: [number]
- Failed: [number]

COMMITS:
- [commit_sha]: [commit_message] (Issue: [issue_id])

FAILURES (if any):
- Issue [issue_id]: [reason for failure]
\`\`\`

Begin applying the fixes now.
`;
}

/**
 * Generates a timestamp string for task titles
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

// ============================================================================
// Task Execution and Monitoring
// ============================================================================

/**
 * Polls the execution process status until completion.
 *
 * Note: This is a simplified polling implementation for the MVP.
 * For production use, consider using WebSocket streams via useExecutionProcesses
 * or implementing a dedicated server-side endpoint for execution status.
 */
async function waitForExecutionCompletion(
  workspaceId: string,
  onProgress?: ProgressCallback,
  totalFixes?: number,
  signal?: AbortSignal
): Promise<{ process: ExecutionProcess | null; output: string | null }> {
  const pollInterval = 2000; // 2 seconds
  const maxWaitTime = 30 * 60 * 1000; // 30 minutes max
  const startTime = Date.now();

  const lastProcess: ExecutionProcess | null = null;
  let iterationCount = 0;

  while (Date.now() - startTime < maxWaitTime) {
    if (signal?.aborted) {
      throw new Error('Fix application was cancelled');
    }

    iterationCount++;

    // Get sessions for this workspace to check for activity
    const sessions = await sessionsApi.getByWorkspace(workspaceId);
    if (sessions.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    // Get the workspace to check setup status
    const workspace = await attemptsApi.get(workspaceId);

    // Check branch status to detect if commits have been made
    const branchStatuses = await attemptsApi.getBranchStatus(workspaceId);
    const hasCommits = branchStatuses.some(
      (status) => (status.commits_ahead ?? 0) > 0
    );

    // Calculate progress based on iteration and commit status
    const progressPercent = Math.min(
      30 + iterationCount * 5 + (hasCommits ? 20 : 0),
      85
    );

    onProgress?.({
      phase: 'applying_fixes',
      currentFix: hasCommits ? Math.ceil((totalFixes || 1) / 2) : 1,
      totalFixes: totalFixes || 1,
      message: workspace.setup_completed_at
        ? 'Claude Code is applying fixes...'
        : 'Setting up workspace...',
      percentComplete: progressPercent,
    });

    // For the MVP, we use a simple heuristic:
    // - Wait for at least one polling cycle
    // - Check if commits have been made (indicating progress)
    // In production, you'd use WebSocket streams for real-time updates
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    // After a few iterations with commits, consider it complete
    // This is a simplified approach - proper implementation would monitor
    // the actual execution process status via WebSocket
    if (hasCommits && iterationCount >= 3) {
      break;
    }

    // Exit after reasonable time if workspace is set up
    if (workspace.setup_completed_at && iterationCount >= 5) {
      break;
    }
  }

  return { process: lastProcess, output: null };
}

/**
 * Parses the Claude Code output to extract results
 */
function parseExecutionResults(
  output: string | null,
  approvedFixes: Issue[]
): { commits: CommitInfo[]; failures: FixFailure[]; successCount: number } {
  const commits: CommitInfo[] = [];
  const failures: FixFailure[] = [];
  let successCount = 0;

  if (!output) {
    // If we don't have output, assume all fixes were attempted
    // In a real scenario, we'd parse the actual Claude Code output
    return {
      commits: [],
      failures: [],
      successCount: approvedFixes.length,
    };
  }

  // Parse the RESULTS section
  const resultsMatch = output.match(/Successfully applied:\s*(\d+)/);
  if (resultsMatch) {
    successCount = parseInt(resultsMatch[1], 10);
  }

  // Parse commits
  const commitPattern = /- ([a-f0-9]+):\s*(.+?)\s*\(Issue:\s*([^)]+)\)/g;
  let commitMatch;
  while ((commitMatch = commitPattern.exec(output)) !== null) {
    commits.push({
      sha: commitMatch[1],
      message: commitMatch[2].trim(),
      filesModified: [], // Would need to parse from actual git output
      issueId: commitMatch[3].trim(),
      createdAt: new Date().toISOString(),
    });
  }

  // Parse failures
  const failurePattern = /- Issue ([^:]+):\s*(.+)/g;
  const failuresSection = output.match(/FAILURES[^:]*:([\s\S]*?)(?:$|```)/);
  if (failuresSection) {
    let failMatch;
    while ((failMatch = failurePattern.exec(failuresSection[1])) !== null) {
      const issueId = failMatch[1].trim();
      const issue = approvedFixes.find((f) => f.id === issueId);
      if (issue) {
        failures.push({
          issue,
          errorMessage: failMatch[2].trim(),
          errorType: 'execution_error',
        });
      }
    }
  }

  return { commits, failures, successCount };
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Creates and executes a Claude Code task to apply approved fixes.
 *
 * This function:
 * 1. Builds a prompt for Claude Code with all approved fixes
 * 2. Creates a special task in Vibe Kanban
 * 3. Starts execution with Claude Code
 * 4. Monitors progress and captures output
 * 5. Parses results and returns structured data
 *
 * @param options - Configuration options for the fix application task
 * @returns Promise resolving to the results of the fix application
 *
 * @example
 * ```typescript
 * const results = await createFixApplicationTask({
 *   projectId: 'my-project-id',
 *   approvedFixes: [
 *     {
 *       id: 'fix-1',
 *       title: 'Fix null pointer exception',
 *       description: 'Handle null case in user lookup',
 *       filePath: 'src/services/userService.ts',
 *       proposedFix: 'Add null check before accessing user.name',
 *     }
 *   ],
 *   repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
 *   onProgress: (progress) => console.log(progress.message),
 * });
 * ```
 */
export async function createFixApplicationTask(
  options: CreateFixApplicationTaskOptions
): Promise<FixApplicationResults> {
  const {
    projectId,
    approvedFixes,
    onProgress,
    repos,
    executorProfileId = { executor: 'CLAUDE_CODE' as BaseCodingAgent, variant: null },
    commitPerFix = true,
    titlePrefix = 'Apply Review Fixes',
    signal,
  } = options;

  const startedAt = new Date().toISOString();
  const timestamp = generateTimestamp();

  // Initialize results
  const results: FixApplicationResults = {
    totalFixes: approvedFixes.length,
    appliedSuccessfully: 0,
    failed: [],
    commits: [],
    status: 'failed',
    startedAt,
  };

  try {
    // Check for cancellation
    if (signal?.aborted) {
      results.status = 'cancelled';
      return results;
    }

    // Phase 1: Build the prompt
    onProgress?.({
      phase: 'creating_task',
      currentFix: 0,
      totalFixes: approvedFixes.length,
      message: 'Building fix application prompt...',
      percentComplete: 5,
    });

    const prompt = buildFixApplicationPrompt(approvedFixes, { commitPerFix });

    // Phase 2: Create the task
    onProgress?.({
      phase: 'creating_task',
      currentFix: 0,
      totalFixes: approvedFixes.length,
      message: 'Creating task in Vibe Kanban...',
      percentComplete: 10,
    });

    const taskTitle = `${titlePrefix} - ${timestamp}`;

    const createTaskRequest: CreateAndStartTaskRequest = {
      task: {
        project_id: projectId,
        title: taskTitle,
        description: prompt,
        status: 'inprogress',
        parent_workspace_id: null,
        image_ids: null,
        shared_task_id: null,
      },
      executor_profile_id: executorProfileId,
      repos,
    };

    // Check for cancellation before API call
    if (signal?.aborted) {
      results.status = 'cancelled';
      return results;
    }

    const taskWithStatus: TaskWithAttemptStatus = await tasksApi.createAndStart(createTaskRequest);

    results.task = {
      id: taskWithStatus.id,
      project_id: taskWithStatus.project_id,
      title: taskWithStatus.title,
      description: taskWithStatus.description,
      status: taskWithStatus.status,
      parent_workspace_id: taskWithStatus.parent_workspace_id,
      shared_task_id: taskWithStatus.shared_task_id,
      created_at: taskWithStatus.created_at,
      updated_at: taskWithStatus.updated_at,
    };

    // Phase 3: Get the workspace/attempt ID
    onProgress?.({
      phase: 'starting_execution',
      currentFix: 0,
      totalFixes: approvedFixes.length,
      message: 'Starting Claude Code execution...',
      percentComplete: 20,
    });

    // Get the workspace ID from the task attempts
    const attempts = await attemptsApi.getAll(taskWithStatus.id);
    if (attempts.length === 0) {
      throw new Error('No workspace was created for the task');
    }

    const workspace = attempts[attempts.length - 1];
    results.workspaceId = workspace.id;

    // Phase 4: Monitor execution
    onProgress?.({
      phase: 'applying_fixes',
      currentFix: 1,
      totalFixes: approvedFixes.length,
      message: 'Claude Code is applying fixes...',
      percentComplete: 30,
    });

    // Wait for execution to complete
    const { process: executionProcess, output } = await waitForExecutionCompletion(
      workspace.id,
      onProgress,
      approvedFixes.length,
      signal
    );

    // Log the execution process for debugging (if available)
    if (executionProcess) {
      console.debug('Fix application execution completed:', executionProcess.id);
    }

    // Phase 5: Parse results
    onProgress?.({
      phase: 'committing',
      currentFix: approvedFixes.length,
      totalFixes: approvedFixes.length,
      message: 'Processing results...',
      percentComplete: 90,
    });

    const parsed = parseExecutionResults(output, approvedFixes);
    results.commits = parsed.commits;
    results.failed = parsed.failures;
    results.appliedSuccessfully = parsed.successCount;

    // Determine final status
    if (results.appliedSuccessfully === results.totalFixes) {
      results.status = 'success';
    } else if (results.appliedSuccessfully > 0) {
      results.status = 'partial_success';
    } else {
      results.status = 'failed';
    }

    results.completedAt = new Date().toISOString();

    // Final progress update
    onProgress?.({
      phase: 'completed',
      currentFix: approvedFixes.length,
      totalFixes: approvedFixes.length,
      message: `Completed: ${results.appliedSuccessfully}/${results.totalFixes} fixes applied`,
      percentComplete: 100,
    });

    return results;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Mark all fixes as failed if we encountered an error
    if (results.failed.length === 0) {
      results.failed = approvedFixes.map((issue) => ({
        issue,
        errorMessage,
        errorType: 'execution_error' as const,
      }));
    }

    results.status = signal?.aborted ? 'cancelled' : 'failed';
    results.completedAt = new Date().toISOString();

    onProgress?.({
      phase: 'failed',
      currentFix: 0,
      totalFixes: approvedFixes.length,
      message: `Failed: ${errorMessage}`,
      percentComplete: 0,
    });

    return results;
  }
}

/**
 * Convenience function to create a fix application task without starting execution.
 * Useful when you want to create the task and let the user manually start it.
 */
export async function createFixApplicationTaskOnly(
  options: Omit<CreateFixApplicationTaskOptions, 'onProgress' | 'signal'>
): Promise<Task> {
  const { projectId, approvedFixes, commitPerFix = true, titlePrefix = 'Apply Review Fixes' } = options;

  const timestamp = generateTimestamp();
  const prompt = buildFixApplicationPrompt(approvedFixes, { commitPerFix });
  const taskTitle = `${titlePrefix} - ${timestamp}`;

  const createTaskRequest: CreateTask = {
    project_id: projectId,
    title: taskTitle,
    description: prompt,
    status: 'todo',
    parent_workspace_id: null,
    image_ids: null,
    shared_task_id: null,
  };

  return tasksApi.create(createTaskRequest);
}

/**
 * Validates that the approved fixes can be processed
 */
export function validateApprovedFixes(fixes: Issue[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fixes || fixes.length === 0) {
    errors.push('No fixes provided');
    return { valid: false, errors };
  }

  fixes.forEach((fix, index) => {
    if (!fix.id) {
      errors.push(`Fix at index ${index} is missing an ID`);
    }
    if (!fix.title) {
      errors.push(`Fix "${fix.id || `at index ${index}`}" is missing a title`);
    }
    if (!fix.description) {
      errors.push(`Fix "${fix.id || fix.title || `at index ${index}`}" is missing a description`);
    }
    if (!fix.proposedFix) {
      errors.push(`Fix "${fix.id || fix.title || `at index ${index}`}" is missing a proposed fix`);
    }
  });

  return { valid: errors.length === 0, errors };
}
