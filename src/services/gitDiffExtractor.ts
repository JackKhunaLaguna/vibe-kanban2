import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Structured data for a task's git diff
 */
export interface TaskDiffData {
  taskId: string;
  taskTitle: string;
  branch: string;
  diff: string;
  modifiedFiles: string[];
  stats: {
    additions: number;
    deletions: number;
  };
}

/**
 * Error information for tasks that failed diff extraction
 */
export interface TaskDiffError {
  taskId: string;
  taskTitle: string;
  branch: string;
  error: string;
}

/**
 * Result of extracting diffs for multiple tasks
 */
export interface ExtractTaskDiffsResult {
  successful: TaskDiffData[];
  failed: TaskDiffError[];
}

/**
 * Input data for a task to extract diff from
 */
export interface TaskInput {
  taskId: string;
  taskTitle: string;
  branch: string;
  repoPath: string;
  targetBranch?: string;
}

/**
 * Options for git diff extraction
 */
export interface ExtractDiffOptions {
  /** Maximum diff output size in bytes (default: 10MB) */
  maxDiffSize?: number;
  /** Timeout for git commands in milliseconds (default: 30000) */
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<ExtractDiffOptions> = {
  maxDiffSize: 10 * 1024 * 1024, // 10MB
  timeout: 30000, // 30 seconds
};

/**
 * Execute a git command safely
 */
async function execGit(
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
    });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };

      if (execError.killed) {
        throw new Error('Git command timed out');
      }

      // Include stderr in the error message for better debugging
      const stderr = execError.stderr || '';
      throw new Error(
        `Git command failed: ${error.message}${stderr ? `\n${stderr}` : ''}`
      );
    }
    throw error;
  }
}

/**
 * Check if a branch exists in the repository
 */
async function branchExists(
  branch: string,
  cwd: string,
  timeout: number
): Promise<boolean> {
  try {
    await execGit(['rev-parse', '--verify', branch], cwd, timeout);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the list of modified files between two branches
 */
async function getModifiedFiles(
  baseBranch: string,
  featureBranch: string,
  cwd: string,
  timeout: number
): Promise<string[]> {
  const { stdout } = await execGit(
    ['diff', '--name-only', `${baseBranch}...${featureBranch}`],
    cwd,
    timeout
  );

  return stdout
    .trim()
    .split('\n')
    .filter((file) => file.length > 0);
}

/**
 * Get diff statistics (additions/deletions) between two branches
 */
async function getDiffStats(
  baseBranch: string,
  featureBranch: string,
  cwd: string,
  timeout: number
): Promise<{ additions: number; deletions: number }> {
  const { stdout } = await execGit(
    ['diff', '--numstat', `${baseBranch}...${featureBranch}`],
    cwd,
    timeout
  );

  let additions = 0;
  let deletions = 0;

  const lines = stdout.trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      // Binary files show '-' for additions/deletions
      const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      if (!isNaN(add)) additions += add;
      if (!isNaN(del)) deletions += del;
    }
  }

  return { additions, deletions };
}

/**
 * Get the full diff between two branches
 */
async function getFullDiff(
  baseBranch: string,
  featureBranch: string,
  cwd: string,
  timeout: number,
  maxSize: number
): Promise<string> {
  const { stdout } = await execGit(
    ['diff', `${baseBranch}...${featureBranch}`],
    cwd,
    timeout
  );

  // Truncate if diff is too large
  if (stdout.length > maxSize) {
    const truncatedDiff = stdout.substring(0, maxSize);
    return `${truncatedDiff}\n\n... [Diff truncated at ${maxSize} bytes] ...`;
  }

  return stdout;
}

/**
 * Extract diff data for a single task
 */
async function extractSingleTaskDiff(
  task: TaskInput,
  options: Required<ExtractDiffOptions>
): Promise<TaskDiffData> {
  const { taskId, taskTitle, branch, repoPath, targetBranch = 'main' } = task;
  const { timeout, maxDiffSize } = options;

  // Verify the feature branch exists
  const featureBranchExists = await branchExists(branch, repoPath, timeout);
  if (!featureBranchExists) {
    throw new Error(`Branch '${branch}' does not exist`);
  }

  // Verify the target branch exists
  const targetBranchExists = await branchExists(targetBranch, repoPath, timeout);
  if (!targetBranchExists) {
    throw new Error(`Target branch '${targetBranch}' does not exist`);
  }

  // Get all diff information in parallel
  const [modifiedFiles, stats, diff] = await Promise.all([
    getModifiedFiles(targetBranch, branch, repoPath, timeout),
    getDiffStats(targetBranch, branch, repoPath, timeout),
    getFullDiff(targetBranch, branch, repoPath, timeout, maxDiffSize),
  ]);

  return {
    taskId,
    taskTitle,
    branch,
    diff,
    modifiedFiles,
    stats,
  };
}

/**
 * Extract git diffs from tasks.
 *
 * This function retrieves git diff information for multiple tasks,
 * comparing each task's branch against the target branch (default: main).
 *
 * @param tasks - Array of task inputs with branch and repository information
 * @param options - Optional configuration for diff extraction
 * @returns Object containing successful diffs and failed extractions
 *
 * @example
 * ```typescript
 * const result = await extractTaskDiffs([
 *   {
 *     taskId: 'task-123',
 *     taskTitle: 'Add new feature',
 *     branch: 'vk/abc123-add-new-feature',
 *     repoPath: '/path/to/repo',
 *     targetBranch: 'main',
 *   },
 * ]);
 *
 * for (const diff of result.successful) {
 *   console.log(`Task ${diff.taskId}: ${diff.stats.additions} additions, ${diff.stats.deletions} deletions`);
 * }
 *
 * for (const error of result.failed) {
 *   console.error(`Task ${error.taskId} failed: ${error.error}`);
 * }
 * ```
 */
export async function extractTaskDiffs(
  tasks: TaskInput[],
  options: ExtractDiffOptions = {}
): Promise<ExtractTaskDiffsResult> {
  const mergedOptions: Required<ExtractDiffOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const results = await Promise.allSettled(
    tasks.map((task) => extractSingleTaskDiff(task, mergedOptions))
  );

  const successful: TaskDiffData[] = [];
  const failed: TaskDiffError[] = [];

  results.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'fulfilled') {
      successful.push(result.value);
    } else {
      failed.push({
        taskId: task.taskId,
        taskTitle: task.taskTitle,
        branch: task.branch,
        error: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      });
    }
  });

  return { successful, failed };
}

/**
 * Extract diff for tasks by fetching task data from Vibe Kanban API.
 *
 * This is a higher-level function that:
 * 1. Fetches task and workspace data from the API
 * 2. Filters for tasks in "inreview" status
 * 3. Extracts diffs for each task
 *
 * @param taskIds - Array of task IDs to extract diffs from
 * @param apiBaseUrl - Base URL for the Vibe Kanban API
 * @param options - Optional configuration for diff extraction
 * @returns Object containing successful diffs and failed extractions
 */
export async function extractTaskDiffsFromApi(
  taskIds: string[],
  apiBaseUrl: string,
  options: ExtractDiffOptions = {}
): Promise<ExtractTaskDiffsResult> {
  const tasks: TaskInput[] = [];
  const failed: TaskDiffError[] = [];

  for (const taskId of taskIds) {
    try {
      // Fetch task details
      const taskResponse = await fetch(`${apiBaseUrl}/api/tasks/${taskId}`);
      if (!taskResponse.ok) {
        throw new Error(`Failed to fetch task: ${taskResponse.statusText}`);
      }
      const taskResult = (await taskResponse.json()) as {
        data: { title: string };
      };
      const task = taskResult.data;

      // Fetch task attempts (workspaces)
      const attemptsResponse = await fetch(
        `${apiBaseUrl}/api/task-attempts?task_id=${taskId}`
      );
      if (!attemptsResponse.ok) {
        throw new Error(
          `Failed to fetch attempts: ${attemptsResponse.statusText}`
        );
      }
      const attemptsResult = (await attemptsResponse.json()) as {
        data: Array<{ id: string; branch: string }>;
      };
      const attempts = attemptsResult.data;

      if (!attempts || attempts.length === 0) {
        throw new Error('No workspace found for task');
      }

      // Use the most recent attempt
      const latestAttempt = attempts[attempts.length - 1];

      // Fetch repos for the attempt to get target branch and repo path
      const reposResponse = await fetch(
        `${apiBaseUrl}/api/task-attempts/${latestAttempt.id}/repos`
      );
      if (!reposResponse.ok) {
        throw new Error(`Failed to fetch repos: ${reposResponse.statusText}`);
      }
      const reposResult = (await reposResponse.json()) as {
        data: Array<{ path: string; target_branch: string }>;
      };
      const repos = reposResult.data;

      if (!repos || repos.length === 0) {
        throw new Error('No repositories found for workspace');
      }

      // For each repo, add a task input
      for (const repo of repos) {
        tasks.push({
          taskId,
          taskTitle: task.title,
          branch: latestAttempt.branch,
          repoPath: repo.path,
          targetBranch: repo.target_branch,
        });
      }
    } catch (error) {
      failed.push({
        taskId,
        taskTitle: 'Unknown',
        branch: 'Unknown',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Extract diffs for all successfully fetched tasks
  const diffResult = await extractTaskDiffs(tasks, options);

  return {
    successful: diffResult.successful,
    failed: [...failed, ...diffResult.failed],
  };
}
