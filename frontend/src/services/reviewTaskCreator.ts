/**
 * Service for creating and executing Claude Code review tasks through Vibe Kanban's task system.
 *
 * This service creates a special "review" task that invokes Claude Code to perform
 * code reviews and captures the structured output.
 */

import {
  tasksApi,
  attemptsApi,
  sessionsApi,
  executionProcessesApi,
} from '@/lib/api';
import {
  BaseCodingAgent,
  type CreateTask,
  type CreateTaskAttemptBody,
  type ExecutorProfileId,
  type ExecutionProcess,
  type ExecutionProcessStatus,
  type WorkspaceRepoInput,
  type PatchType,
  type NormalizedEntry,
} from 'shared/types';
import { streamJsonPatchEntries } from '@/utils/streamJsonPatchEntries';

// ============================================================================
// Types
// ============================================================================

/**
 * Severity level of an issue found during review
 */
export type IssueSeverity = 'critical' | 'major' | 'minor';

/**
 * Category of an issue found during review
 */
export type IssueCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'bug'
  | 'style'
  | 'documentation'
  | 'testing'
  | 'other';

/**
 * An individual issue found during the code review
 */
export interface Issue {
  /** Unique identifier for the issue */
  id: string;
  /** ID of the task this issue relates to */
  taskId: string;
  /** Severity level of the issue */
  severity: IssueSeverity;
  /** Category of the issue */
  category: IssueCategory;
  /** Brief title/summary of the issue */
  title: string;
  /** Detailed description of the issue */
  description: string;
  /** File path where the issue was found (if applicable) */
  filePath?: string;
  /** Line number where the issue starts (if applicable) */
  lineStart?: number;
  /** Line number where the issue ends (if applicable) */
  lineEnd?: number;
  /** Suggested fix or recommendation */
  suggestion?: string;
  /** Code snippet showing the problematic code */
  codeSnippet?: string;
}

/**
 * Summary of the review results
 */
export interface ReviewSummary {
  /** Total number of tasks reviewed */
  totalTasks: number;
  /** Total number of issues found */
  issuesFound: number;
  /** Number of critical issues */
  criticalIssues: number;
  /** Number of major issues */
  majorIssues: number;
  /** Number of minor issues */
  minorIssues: number;
}

/**
 * Complete review results returned by createReviewTask
 */
export interface ReviewResults {
  /** Summary statistics of the review */
  summary: ReviewSummary;
  /** List of all issues found */
  issues: Issue[];
  /** Timestamp when the review was completed */
  timestamp: Date;
  /** Raw output from Claude Code (for debugging) */
  rawOutput?: string;
  /** The task ID of the review task */
  reviewTaskId: string;
  /** The workspace/attempt ID */
  attemptId: string;
}

/**
 * Progress state during review execution
 */
export type ReviewProgress =
  | { phase: 'creating'; message: string }
  | { phase: 'starting'; message: string }
  | { phase: 'running'; message: string; output?: string }
  | { phase: 'parsing'; message: string }
  | { phase: 'completed'; message: string }
  | { phase: 'error'; message: string; error: Error };

/**
 * Callback for progress updates
 */
export type ProgressCallback = (progress: ReviewProgress) => void;

/**
 * Options for creating a review task
 */
export interface CreateReviewTaskOptions {
  /** Project ID to create the task in */
  projectId: string;
  /** Repository inputs for the task */
  repos: WorkspaceRepoInput[];
  /** Executor profile to use (defaults to CLAUDE_CODE) */
  executorProfile?: ExecutorProfileId;
  /** Timeout in milliseconds (defaults to 5 minutes) */
  timeout?: number;
  /** Parent workspace ID if this is a subtask */
  parentWorkspaceId?: string;
}

/**
 * Error thrown when review task fails
 */
export class ReviewTaskError extends Error {
  constructor(
    message: string,
    public readonly phase: ReviewProgress['phase'],
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ReviewTaskError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const DEFAULT_EXECUTOR_PROFILE: ExecutorProfileId = {
  executor: BaseCodingAgent.CLAUDE_CODE,
  variant: null,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a timestamp string for the review task title
 */
function getTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Generate a unique ID for issues
 */
function generateIssueId(): string {
  return `issue-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Build the review prompt for Claude Code
 */
function buildReviewPrompt(taskIds: string[], customPrompt: string): string {
  const taskList = taskIds.map((id) => `- Task ID: ${id}`).join('\n');

  return `${customPrompt}

## Tasks to Review
${taskList}

## Output Format
After completing the review, output a JSON block with the following structure:

\`\`\`json
{
  "summary": {
    "totalTasks": <number>,
    "issuesFound": <number>,
    "criticalIssues": <number>,
    "majorIssues": <number>,
    "minorIssues": <number>
  },
  "issues": [
    {
      "taskId": "<task_id>",
      "severity": "critical" | "major" | "minor",
      "category": "security" | "performance" | "maintainability" | "bug" | "style" | "documentation" | "testing" | "other",
      "title": "<brief title>",
      "description": "<detailed description>",
      "filePath": "<optional file path>",
      "lineStart": <optional line number>,
      "lineEnd": <optional line number>,
      "suggestion": "<optional fix recommendation>",
      "codeSnippet": "<optional code snippet>"
    }
  ]
}
\`\`\`

Ensure the JSON is valid and complete.`;
}

/**
 * Parse the review output from Claude Code to extract the JSON results
 */
function parseReviewOutput(output: string): Omit<ReviewResults, 'timestamp' | 'reviewTaskId' | 'attemptId'> {
  // Try to find a JSON block in the output
  const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);

  let jsonStr: string | null = null;

  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    // Try to find raw JSON object
    const jsonMatch = output.match(/\{[\s\S]*"summary"[\s\S]*"issues"[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
  }

  if (!jsonStr) {
    // Return empty results if no JSON found
    return {
      summary: {
        totalTasks: 0,
        issuesFound: 0,
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
      },
      issues: [],
      rawOutput: output,
    };
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize the parsed data
    const summary: ReviewSummary = {
      totalTasks: Number(parsed.summary?.totalTasks) || 0,
      issuesFound: Number(parsed.summary?.issuesFound) || 0,
      criticalIssues: Number(parsed.summary?.criticalIssues) || 0,
      majorIssues: Number(parsed.summary?.majorIssues) || 0,
      minorIssues: Number(parsed.summary?.minorIssues) || 0,
    };

    const issues: Issue[] = (parsed.issues || []).map((issue: Partial<Issue>) => ({
      id: generateIssueId(),
      taskId: String(issue.taskId || ''),
      severity: validateSeverity(issue.severity),
      category: validateCategory(issue.category),
      title: String(issue.title || 'Untitled Issue'),
      description: String(issue.description || ''),
      filePath: issue.filePath ? String(issue.filePath) : undefined,
      lineStart: typeof issue.lineStart === 'number' ? issue.lineStart : undefined,
      lineEnd: typeof issue.lineEnd === 'number' ? issue.lineEnd : undefined,
      suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
      codeSnippet: issue.codeSnippet ? String(issue.codeSnippet) : undefined,
    }));

    return {
      summary,
      issues,
      rawOutput: output,
    };
  } catch (parseError) {
    console.error('Failed to parse review JSON:', parseError);
    return {
      summary: {
        totalTasks: 0,
        issuesFound: 0,
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
      },
      issues: [],
      rawOutput: output,
    };
  }
}

/**
 * Validate and normalize severity value
 */
function validateSeverity(value: unknown): IssueSeverity {
  if (value === 'critical' || value === 'major' || value === 'minor') {
    return value;
  }
  return 'minor';
}

/**
 * Validate and normalize category value
 */
function validateCategory(value: unknown): IssueCategory {
  const validCategories: IssueCategory[] = [
    'security',
    'performance',
    'maintainability',
    'bug',
    'style',
    'documentation',
    'testing',
    'other',
  ];
  if (typeof value === 'string' && validCategories.includes(value as IssueCategory)) {
    return value as IssueCategory;
  }
  return 'other';
}

/**
 * Wait for execution process to complete and collect output
 */
async function waitForExecutionComplete(
  executionProcessId: string,
  timeout: number,
  onProgress?: ProgressCallback
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const url = `/api/execution-processes/${executionProcessId}/normalized-logs/ws`;

    const controller = streamJsonPatchEntries<PatchType>(url, {
      onEntries(entries) {
        for (const entry of entries) {
          if (entry.type === 'NORMALIZED_ENTRY') {
            const normalized = entry.content as NormalizedEntry;
            if (
              normalized.entry_type.type === 'assistant_message' ||
              normalized.entry_type.type === 'tool_use'
            ) {
              output += normalized.content + '\n';
              onProgress?.({
                phase: 'running',
                message: 'Processing review...',
                output: output.slice(-500), // Last 500 chars for preview
              });
            }
          } else if (entry.type === 'STDOUT' || entry.type === 'STDERR') {
            output += entry.content;
          }
        }
      },
      onFinished: () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        controller.close();
        resolve(output);
      },
      onError: (err) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        controller.close();
        reject(new ReviewTaskError('Stream error', 'running', err instanceof Error ? err : new Error(String(err))));
      },
    });

    // Set up timeout
    timeoutId = setTimeout(() => {
      controller.close();
      reject(new ReviewTaskError(`Review timed out after ${timeout}ms`, 'running'));
    }, timeout);
  });
}

/**
 * Poll for execution process status
 */
async function pollForCodingAgentProcess(
  workspaceId: string,
  timeout: number
): Promise<ExecutionProcess> {
  const startTime = Date.now();
  const pollInterval = 500; // 500ms

  while (Date.now() - startTime < timeout) {
    const sessions = await sessionsApi.getByWorkspace(workspaceId);
    if (sessions.length > 0) {
      const session = sessions[0];
      // Query for execution processes via the session
      // We need to find a coding agent process
      try {
        // Get workspace attempts to find execution processes
        // Since there's no direct API, we'll poll the execution process details
        // by checking if any process exists
        const response = await fetch(
          `/api/execution-processes?session_id=${session.id}`
        );
        if (response.ok) {
          const processes: ExecutionProcess[] = await response.json();
          const codingAgent = processes.find(
            (p) => p.run_reason === 'codingagent'
          );
          if (codingAgent) {
            return codingAgent;
          }
        }
      } catch {
        // Continue polling
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new ReviewTaskError(
    'Timeout waiting for coding agent process to start',
    'starting'
  );
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Create and execute a Claude Code review task.
 *
 * This function:
 * 1. Creates a special review task in Vibe Kanban
 * 2. Invokes Claude Code through the existing integration
 * 3. Monitors Claude Code progress
 * 4. Captures and parses Claude Code output
 * 5. Returns structured review results
 *
 * @param taskIds - Array of task IDs to review
 * @param prompt - The review prompt to send to Claude Code
 * @param options - Configuration options
 * @param onProgress - Optional callback for progress updates
 * @returns Structured review results
 * @throws ReviewTaskError if the review fails
 *
 * @example
 * ```typescript
 * const results = await createReviewTask(
 *   ['task-123', 'task-456'],
 *   'Review the code changes for security vulnerabilities',
 *   { projectId: 'project-abc', repos: [{ repo_id: 'repo-1', target_branch: 'main' }] },
 *   (progress) => console.log(progress.message)
 * );
 * console.log(`Found ${results.summary.issuesFound} issues`);
 * ```
 */
export async function createReviewTask(
  taskIds: string[],
  prompt: string,
  options: CreateReviewTaskOptions,
  onProgress?: ProgressCallback
): Promise<ReviewResults> {
  const {
    projectId,
    repos,
    executorProfile = DEFAULT_EXECUTOR_PROFILE,
    timeout = DEFAULT_TIMEOUT,
    parentWorkspaceId,
  } = options;

  try {
    // Phase 1: Create the review task
    onProgress?.({
      phase: 'creating',
      message: 'Creating review task...',
    });

    const taskTitle = `Code Review - ${getTimestamp()}`;
    const taskDescription = buildReviewPrompt(taskIds, prompt);

    const createTaskData: CreateTask = {
      project_id: projectId,
      title: taskTitle,
      description: taskDescription,
      status: 'inprogress',
      parent_workspace_id: parentWorkspaceId ?? null,
      image_ids: null,
      shared_task_id: null,
    };

    const task = await tasksApi.create(createTaskData);

    // Phase 2: Create and start the attempt
    onProgress?.({
      phase: 'starting',
      message: 'Starting Claude Code execution...',
    });

    const attemptData: CreateTaskAttemptBody = {
      task_id: task.id,
      executor_profile_id: executorProfile,
      repos,
    };

    const workspace = await attemptsApi.create(attemptData);

    // Wait for the coding agent process to start
    const executionProcess = await pollForCodingAgentProcess(
      workspace.id,
      timeout
    );

    // Phase 3: Monitor execution and collect output
    onProgress?.({
      phase: 'running',
      message: 'Claude Code is reviewing...',
    });

    const output = await waitForExecutionComplete(
      executionProcess.id,
      timeout,
      onProgress
    );

    // Phase 4: Parse the output
    onProgress?.({
      phase: 'parsing',
      message: 'Parsing review results...',
    });

    const parsedResults = parseReviewOutput(output);

    // Phase 5: Complete
    onProgress?.({
      phase: 'completed',
      message: 'Review completed successfully',
    });

    return {
      ...parsedResults,
      timestamp: new Date(),
      reviewTaskId: task.id,
      attemptId: workspace.id,
    };
  } catch (error) {
    const reviewError =
      error instanceof ReviewTaskError
        ? error
        : new ReviewTaskError(
            error instanceof Error ? error.message : 'Unknown error',
            'error',
            error instanceof Error ? error : undefined
          );

    onProgress?.({
      phase: 'error',
      message: reviewError.message,
      error: reviewError,
    });

    throw reviewError;
  }
}

/**
 * Convenience function to check if a task is currently being reviewed
 */
export async function isTaskUnderReview(taskId: string): Promise<boolean> {
  try {
    const task = await tasksApi.getById(taskId);
    return (
      task.title.startsWith('Code Review -') && task.status === 'inprogress'
    );
  } catch {
    return false;
  }
}

/**
 * Get the status of an ongoing review
 */
export async function getReviewStatus(
  attemptId: string
): Promise<ExecutionProcessStatus | null> {
  try {
    const sessions = await sessionsApi.getByWorkspace(attemptId);
    if (sessions.length === 0) return null;

    const process = await executionProcessesApi.getDetails(sessions[0].id);
    return process.status;
  } catch {
    return null;
  }
}

/**
 * Stop an ongoing review
 */
export async function stopReview(attemptId: string): Promise<void> {
  await attemptsApi.stop(attemptId);
}
