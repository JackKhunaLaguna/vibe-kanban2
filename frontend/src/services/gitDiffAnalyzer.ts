import type { Diff, Task, Workspace } from 'shared/types';
import { attemptsApi, tasksApi } from '@/lib/api';

/**
 * Represents line-level change information for a file
 */
export interface FileDiff {
  /** Path to the file that was changed */
  filePath: string;
  /** Number of lines added */
  additions: number;
  /** Number of lines removed */
  deletions: number;
  /** The raw diff content (unified diff format) */
  diff: string;
}

/**
 * Represents all git changes associated with a task
 */
export interface TaskDiff {
  /** The task ID */
  taskId: string;
  /** Human-readable task title */
  taskTitle: string;
  /** Git branch name for this task's workspace */
  branch: string;
  /** List of files that were modified */
  modifiedFiles: string[];
  /** Detailed diff information for each file */
  changes: FileDiff[];
}

/**
 * Error details when a task diff cannot be retrieved
 */
export interface TaskDiffError {
  taskId: string;
  error: string;
  code: 'NO_WORKSPACE' | 'DIFF_FETCH_FAILED' | 'TASK_NOT_FOUND' | 'UNKNOWN';
}

/**
 * Result of analyzing multiple tasks
 */
export interface AnalyzeTasksResult {
  /** Successfully retrieved task diffs */
  diffs: TaskDiff[];
  /** Tasks that failed to retrieve diffs */
  errors: TaskDiffError[];
}

/**
 * Convert a Diff object from the API to our FileDiff format
 */
function convertDiffToFileDiff(diff: Diff): FileDiff {
  const filePath = diff.newPath ?? diff.oldPath ?? 'unknown';

  // Generate unified diff content from old/new content
  let diffContent = '';
  if (diff.oldContent !== null || diff.newContent !== null) {
    diffContent = generateUnifiedDiff(
      filePath,
      diff.oldContent ?? '',
      diff.newContent ?? '',
      diff.change
    );
  } else if (diff.contentOmitted) {
    diffContent = `[Content omitted - file too large]\n+${diff.additions ?? 0} additions, -${diff.deletions ?? 0} deletions`;
  }

  return {
    filePath,
    additions: diff.additions ?? countAdditions(diff.oldContent, diff.newContent),
    deletions: diff.deletions ?? countDeletions(diff.oldContent, diff.newContent),
    diff: diffContent,
  };
}

/**
 * Generate a unified diff format string from old and new content
 */
function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  changeKind: string
): string {
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;

  if (changeKind === 'added') {
    const lines = newContent.split('\n');
    const addedLines = lines.map((line) => `+${line}`).join('\n');
    return `${header}@@ -0,0 +1,${lines.length} @@\n${addedLines}`;
  }

  if (changeKind === 'deleted') {
    const lines = oldContent.split('\n');
    const deletedLines = lines.map((line) => `-${line}`).join('\n');
    return `${header}@@ -1,${lines.length} +0,0 @@\n${deletedLines}`;
  }

  // For modified files, generate a simple diff
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple line-by-line diff (not optimal, but functional)
  const diffLines: string[] = [];
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined && newLine !== undefined) {
      diffLines.push(`+${newLine}`);
    } else if (oldLine !== undefined && newLine === undefined) {
      diffLines.push(`-${oldLine}`);
    } else if (oldLine !== newLine) {
      diffLines.push(`-${oldLine}`);
      diffLines.push(`+${newLine}`);
    } else {
      diffLines.push(` ${oldLine}`);
    }
  }

  return `${header}@@ -1,${oldLines.length} +1,${newLines.length} @@\n${diffLines.join('\n')}`;
}

/**
 * Count additions by comparing old and new content
 */
function countAdditions(
  oldContent: string | null,
  newContent: string | null
): number {
  if (oldContent === null && newContent !== null) {
    return newContent.split('\n').length;
  }
  if (oldContent === null || newContent === null) {
    return 0;
  }

  const oldLines = new Set(oldContent.split('\n'));
  const newLines = newContent.split('\n');
  return newLines.filter((line) => !oldLines.has(line)).length;
}

/**
 * Count deletions by comparing old and new content
 */
function countDeletions(
  oldContent: string | null,
  newContent: string | null
): number {
  if (newContent === null && oldContent !== null) {
    return oldContent.split('\n').length;
  }
  if (oldContent === null || newContent === null) {
    return 0;
  }

  const newLines = new Set(newContent.split('\n'));
  const oldLines = oldContent.split('\n');
  return oldLines.filter((line) => !newLines.has(line)).length;
}

/**
 * Fetch diffs for a single workspace using WebSocket connection
 * Returns a promise that resolves when the diff stream is complete
 */
async function fetchWorkspaceDiffs(workspaceId: string): Promise<Diff[]> {
  return new Promise((resolve, reject) => {
    const diffs: Diff[] = [];
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/task-attempts/${workspaceId}/diff/ws`;

    const ws = new WebSocket(wsUrl);
    let closed = false;

    const cleanup = (id: ReturnType<typeof setTimeout>) => {
      if (closed) return;
      closed = true;
      clearTimeout(id);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };

    // Set a timeout for the WebSocket connection
    const timeoutId = setTimeout(() => {
      cleanup(timeoutId);
      resolve(diffs); // Return whatever diffs we collected so far
    }, 10000); // 10 second timeout

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle JSON patch format used by the diff stream
        if (Array.isArray(data)) {
          for (const patch of data) {
            if (
              patch.op === 'add' &&
              patch.value?.type === 'DIFF' &&
              patch.value?.content
            ) {
              diffs.push(patch.value.content);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      cleanup(timeoutId);
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = () => {
      cleanup(timeoutId);
      resolve(diffs);
    };
  });
}

/**
 * Get the latest workspace for a task
 */
async function getLatestWorkspace(taskId: string): Promise<Workspace | null> {
  try {
    const workspaces = await attemptsApi.getAll(taskId);
    if (workspaces.length === 0) {
      return null;
    }
    // Sort by created_at descending and return the most recent
    return workspaces.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  } catch {
    return null;
  }
}

/**
 * Analyze a single task and return its diff information
 */
async function analyzeTask(taskId: string): Promise<TaskDiff | TaskDiffError> {
  try {
    // Fetch task details
    let task: Task;
    try {
      task = await tasksApi.getById(taskId);
    } catch {
      return {
        taskId,
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
      };
    }

    // Get the latest workspace for this task
    const workspace = await getLatestWorkspace(taskId);
    if (!workspace) {
      return {
        taskId,
        error: 'No workspace found for task',
        code: 'NO_WORKSPACE',
      };
    }

    // Fetch diffs from the workspace
    let diffs: Diff[];
    try {
      diffs = await fetchWorkspaceDiffs(workspace.id);
    } catch (error) {
      return {
        taskId,
        error:
          error instanceof Error ? error.message : 'Failed to fetch diffs',
        code: 'DIFF_FETCH_FAILED',
      };
    }

    // Convert diffs to our format
    const changes = diffs.map(convertDiffToFileDiff);
    const modifiedFiles = changes.map((c) => c.filePath);

    return {
      taskId,
      taskTitle: task.title,
      branch: workspace.branch,
      modifiedFiles,
      changes,
    };
  } catch (error) {
    return {
      taskId,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'UNKNOWN',
    };
  }
}

/**
 * Analyze multiple tasks and extract git diff information for each
 *
 * @param taskIds - Array of task IDs to analyze
 * @returns Promise resolving to diffs for each task with error information
 *
 * @example
 * ```typescript
 * const result = await analyzeTasks(['task-1', 'task-2']);
 * console.log(result.diffs); // Successfully retrieved diffs
 * console.log(result.errors); // Tasks that failed
 * ```
 */
export async function analyzeTasks(
  taskIds: string[]
): Promise<AnalyzeTasksResult> {
  const results = await Promise.all(taskIds.map(analyzeTask));

  const diffs: TaskDiff[] = [];
  const errors: TaskDiffError[] = [];

  for (const result of results) {
    if ('error' in result) {
      errors.push(result);
    } else {
      diffs.push(result);
    }
  }

  return { diffs, errors };
}

/**
 * Analyze a single task and return its diff information
 *
 * @param taskId - The task ID to analyze
 * @returns Promise resolving to the task diff or an error
 */
export async function analyzeTaskDiff(
  taskId: string
): Promise<TaskDiff | TaskDiffError> {
  return analyzeTask(taskId);
}

/**
 * Get a summary of changes for multiple tasks
 *
 * @param taskIds - Array of task IDs to summarize
 * @returns Promise with summary statistics
 */
export async function getTasksDiffSummary(taskIds: string[]): Promise<{
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  totalFilesModified: number;
  totalAdditions: number;
  totalDeletions: number;
}> {
  const result = await analyzeTasks(taskIds);

  let totalAdditions = 0;
  let totalDeletions = 0;
  let totalFilesModified = 0;

  for (const diff of result.diffs) {
    totalFilesModified += diff.modifiedFiles.length;
    for (const change of diff.changes) {
      totalAdditions += change.additions;
      totalDeletions += change.deletions;
    }
  }

  return {
    totalTasks: taskIds.length,
    successfulTasks: result.diffs.length,
    failedTasks: result.errors.length,
    totalFilesModified,
    totalAdditions,
    totalDeletions,
  };
}
