/**
 * Review Orchestrator Service
 *
 * Coordinates the entire code review process across multiple services.
 * This is the "brain" that orchestrates all review-related services.
 */

import { tasksApi, attemptsApi } from '@/lib/api';
import type {
  Task,
  Workspace,
  RepoBranchStatus,
  Diff,
  ConflictOp,
} from 'shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a conflict detected during review
 */
export interface Conflict {
  /** The file path where the conflict exists */
  filePath: string;
  /** The type of git operation that caused the conflict */
  operation: ConflictOp;
  /** Repository ID where the conflict was detected */
  repoId: string;
  /** Repository name for display purposes */
  repoName: string;
}

/**
 * Code quality issue severity levels
 */
export type CodeIssueSeverity = 'error' | 'warning' | 'info' | 'suggestion';

/**
 * Represents a code quality issue detected during analysis
 */
export interface CodeIssue {
  /** Unique identifier for the issue */
  id: string;
  /** File path where the issue was found */
  filePath: string;
  /** Line number where the issue starts */
  lineNumber: number;
  /** End line number (for multi-line issues) */
  endLineNumber?: number;
  /** Issue severity level */
  severity: CodeIssueSeverity;
  /** Category of the issue (e.g., 'security', 'performance', 'style') */
  category: string;
  /** Human-readable message describing the issue */
  message: string;
  /** Optional suggested fix */
  suggestion?: string;
  /** Rule or check that detected this issue */
  rule?: string;
}

/**
 * A code fragment with location information for review comments
 */
export interface CodeFragment {
  /** File path */
  file: string;
  /** Starting line number */
  startLine: number;
  /** Ending line number */
  endLine: number;
  /** Comment or message about this fragment */
  message: string;
}

/**
 * A review comment from Claude
 */
export interface ReviewComment {
  /** The main comment text */
  comment: string;
  /** Associated code fragments */
  fragments: CodeFragment[];
}

/**
 * Results from Claude's AI review
 */
export interface ReviewResults {
  /** High-level summary of the review */
  summary: string;
  /** Detailed review comments */
  comments: ReviewComment[];
  /** Map of file paths to their content hashes */
  fileHashMap: Record<string, string>;
  /** Whether the review was successful */
  success: boolean;
  /** Error message if the review failed */
  error?: string;
}

/**
 * Project context information for the review
 */
export interface ProjectContext {
  /** Project ID */
  projectId: string;
  /** Project name */
  projectName: string;
  /** Repository paths involved */
  repoPaths: string[];
  /** Main branch name */
  mainBranch: string;
  /** Current feature branches being reviewed */
  featureBranches: string[];
  /** Files that are most critical to review */
  criticalFiles?: string[];
}

/**
 * Git diff analysis result
 */
export interface DiffAnalysis {
  /** Raw diffs from git */
  diffs: Diff[];
  /** Total number of files changed */
  filesChanged: number;
  /** Total lines added */
  linesAdded: number;
  /** Total lines deleted */
  linesDeleted: number;
  /** Files with the most changes */
  hotspots: string[];
}

/**
 * Overall status of the review
 */
export type ReviewStatus = 'approved' | 'needs-work' | 'blocked';

/**
 * Complete review result combining all service outputs
 */
export interface CompleteReview {
  /** Number of tasks included in this review */
  taskCount: number;
  /** All detected conflicts */
  conflicts: Conflict[];
  /** All code quality issues found */
  codeIssues: CodeIssue[];
  /** Results from Claude's AI review */
  claudeReview: ReviewResults;
  /** Overall status of the review */
  overallStatus: ReviewStatus;
  /** Human-readable summary */
  summary: string;
  /** When the review was completed */
  timestamp: Date;
  /** Task details that were reviewed */
  tasks: TaskInfo[];
  /** Diff analysis results */
  diffAnalysis?: DiffAnalysis;
  /** Project context used for the review */
  projectContext?: ProjectContext;
  /** Any errors that occurred during partial failures */
  errors: ReviewError[];
}

/**
 * Basic task information for the review
 */
export interface TaskInfo {
  id: string;
  title: string;
  description: string | null;
  workspaceId?: string;
  branch?: string;
}

/**
 * Error that occurred during review
 */
export interface ReviewError {
  /** Which step failed */
  step: ReviewStep;
  /** Error message */
  message: string;
  /** Whether this error is recoverable */
  recoverable: boolean;
}

/**
 * Steps in the review process
 */
export type ReviewStep =
  | 'fetch-tasks'
  | 'extract-diffs'
  | 'get-context'
  | 'detect-conflicts'
  | 'analyze-quality'
  | 'claude-review'
  | 'aggregate';

/**
 * Progress update for UI tracking
 */
export interface ReviewProgress {
  /** Current step being executed */
  currentStep: ReviewStep;
  /** Total number of steps */
  totalSteps: number;
  /** Current step number (1-indexed) */
  currentStepNumber: number;
  /** Human-readable step description */
  stepDescription: string;
  /** Progress within the current step (0-100) */
  stepProgress: number;
  /** Any warning or info messages */
  messages: string[];
}

/**
 * Progress callback type
 */
export type ProgressCallback = (progress: ReviewProgress) => void;

// ============================================================================
// Service Interfaces (for dependency injection)
// ============================================================================

/**
 * Interface for git diff analysis service
 */
export interface GitDiffAnalyzer {
  analyzeDiffs(workspaceId: string): Promise<DiffAnalysis>;
}

/**
 * Interface for project context provider service
 */
export interface ProjectContextProvider {
  getContext(projectId: string, workspaceIds: string[]): Promise<ProjectContext>;
}

/**
 * Interface for conflict detection service
 */
export interface ConflictDetector {
  detectConflicts(branchStatuses: RepoBranchStatus[]): Conflict[];
}

/**
 * Interface for code quality analysis service
 */
export interface CodeQualityAnalyzer {
  analyzeQuality(diffs: Diff[]): Promise<CodeIssue[]>;
}

/**
 * Interface for Claude review service
 */
export interface ClaudeReviewService {
  conductReview(
    diffs: Diff[],
    context: ProjectContext,
    conflicts: Conflict[],
    codeIssues: CodeIssue[]
  ): Promise<ReviewResults>;
}

/**
 * Configuration for the review orchestrator
 */
export interface ReviewOrchestratorConfig {
  gitDiffAnalyzer?: GitDiffAnalyzer;
  projectContextProvider?: ProjectContextProvider;
  conflictDetector?: ConflictDetector;
  codeQualityAnalyzer?: CodeQualityAnalyzer;
  claudeReviewService?: ClaudeReviewService;
}

// ============================================================================
// Default Implementations
// ============================================================================

/**
 * Default conflict detector using branch status information
 */
const defaultConflictDetector: ConflictDetector = {
  detectConflicts(branchStatuses: RepoBranchStatus[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (const status of branchStatuses) {
      if (status.conflict_op && status.conflicted_files.length > 0) {
        for (const filePath of status.conflicted_files) {
          conflicts.push({
            filePath,
            operation: status.conflict_op,
            repoId: status.repo_id,
            repoName: status.repo_name,
          });
        }
      }
    }

    return conflicts;
  },
};

/**
 * Default git diff analyzer (placeholder - requires actual implementation)
 */
const defaultGitDiffAnalyzer: GitDiffAnalyzer = {
  async analyzeDiffs(): Promise<DiffAnalysis> {
    // Placeholder: returns empty analysis until actual implementation is provided
    return {
      diffs: [],
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      hotspots: [],
    };
  },
};

/**
 * Default project context provider (placeholder - requires actual implementation)
 */
const defaultProjectContextProvider: ProjectContextProvider = {
  async getContext(projectId: string): Promise<ProjectContext> {
    return {
      projectId,
      projectName: 'Unknown Project',
      repoPaths: [],
      mainBranch: 'main',
      featureBranches: [],
    };
  },
};

/**
 * Default code quality analyzer (placeholder - requires actual implementation)
 */
const defaultCodeQualityAnalyzer: CodeQualityAnalyzer = {
  async analyzeQuality(): Promise<CodeIssue[]> {
    // Placeholder: returns empty issues until actual implementation is provided
    return [];
  },
};

/**
 * Default Claude review service (placeholder - requires actual implementation)
 */
const defaultClaudeReviewService: ClaudeReviewService = {
  async conductReview(): Promise<ReviewResults> {
    // Placeholder: returns error until actual implementation is provided
    return {
      summary: 'Claude review service not configured',
      comments: [],
      fileHashMap: {},
      success: false,
      error: 'Claude review service not configured',
    };
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

const STEP_DESCRIPTIONS: Record<ReviewStep, string> = {
  'fetch-tasks': 'Fetching task information',
  'extract-diffs': 'Extracting git diffs',
  'get-context': 'Getting project context',
  'detect-conflicts': 'Detecting conflicts',
  'analyze-quality': 'Analyzing code quality',
  'claude-review': 'Running Claude AI review',
  aggregate: 'Aggregating results',
};

const STEP_ORDER: ReviewStep[] = [
  'fetch-tasks',
  'extract-diffs',
  'get-context',
  'detect-conflicts',
  'analyze-quality',
  'claude-review',
  'aggregate',
];

function createProgress(
  step: ReviewStep,
  stepProgress: number = 0,
  messages: string[] = []
): ReviewProgress {
  const stepIndex = STEP_ORDER.indexOf(step);
  return {
    currentStep: step,
    totalSteps: STEP_ORDER.length,
    currentStepNumber: stepIndex + 1,
    stepDescription: STEP_DESCRIPTIONS[step],
    stepProgress,
    messages,
  };
}

function determineOverallStatus(
  conflicts: Conflict[],
  codeIssues: CodeIssue[],
  claudeReview: ReviewResults
): ReviewStatus {
  // If there are unresolved conflicts, the review is blocked
  if (conflicts.length > 0) {
    return 'blocked';
  }

  // If Claude's review failed or there are critical issues, needs work
  if (!claudeReview.success) {
    return 'needs-work';
  }

  // Check for error-level code issues
  const hasErrors = codeIssues.some((issue) => issue.severity === 'error');
  if (hasErrors) {
    return 'needs-work';
  }

  // Check Claude's review comments for blocking issues
  const hasBlockingComments = claudeReview.comments.some(
    (comment) =>
      comment.comment.toLowerCase().includes('must fix') ||
      comment.comment.toLowerCase().includes('critical') ||
      comment.comment.toLowerCase().includes('security vulnerability')
  );
  if (hasBlockingComments) {
    return 'needs-work';
  }

  return 'approved';
}

function generateSummary(
  tasks: TaskInfo[],
  conflicts: Conflict[],
  codeIssues: CodeIssue[],
  claudeReview: ReviewResults,
  overallStatus: ReviewStatus
): string {
  const parts: string[] = [];

  // Task count
  parts.push(`Reviewed ${tasks.length} task${tasks.length !== 1 ? 's' : ''}.`);

  // Conflicts
  if (conflicts.length > 0) {
    parts.push(
      `Found ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} that must be resolved.`
    );
  }

  // Code issues summary
  const errorCount = codeIssues.filter((i) => i.severity === 'error').length;
  const warningCount = codeIssues.filter((i) => i.severity === 'warning').length;
  if (errorCount > 0 || warningCount > 0) {
    const issueParts: string[] = [];
    if (errorCount > 0)
      issueParts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
    if (warningCount > 0)
      issueParts.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
    parts.push(`Code quality: ${issueParts.join(', ')}.`);
  }

  // Claude review summary
  if (claudeReview.success && claudeReview.summary) {
    parts.push(claudeReview.summary);
  } else if (!claudeReview.success && claudeReview.error) {
    parts.push(`AI review error: ${claudeReview.error}`);
  }

  // Overall status
  const statusMessages: Record<ReviewStatus, string> = {
    approved: 'Ready for merge.',
    'needs-work': 'Changes required before merge.',
    blocked: 'Cannot proceed until conflicts are resolved.',
  };
  parts.push(statusMessages[overallStatus]);

  return parts.join(' ');
}

// ============================================================================
// Main Orchestrator Function
// ============================================================================

/**
 * Conducts a comprehensive code review for the given tasks.
 *
 * This function orchestrates the entire review process:
 * 1. Fetches task information from Vibe Kanban
 * 2. Extracts git diffs using gitDiffAnalyzer
 * 3. Gets project context using projectContextProvider
 * 4. Detects conflicts using conflictDetector
 * 5. Analyzes code quality using codeQualityAnalyzer
 * 6. Sends all data to Claude for comprehensive review
 * 7. Aggregates all results
 * 8. Generates final review report
 *
 * @param taskIds - Array of task IDs to review
 * @param config - Optional configuration with service implementations
 * @param onProgress - Optional callback for progress updates
 * @returns Complete review results
 */
export async function conductReview(
  taskIds: string[],
  config: ReviewOrchestratorConfig = {},
  onProgress?: ProgressCallback
): Promise<CompleteReview> {
  // Initialize services with defaults
  const gitDiffAnalyzer = config.gitDiffAnalyzer ?? defaultGitDiffAnalyzer;
  const projectContextProvider =
    config.projectContextProvider ?? defaultProjectContextProvider;
  const conflictDetector = config.conflictDetector ?? defaultConflictDetector;
  const codeQualityAnalyzer =
    config.codeQualityAnalyzer ?? defaultCodeQualityAnalyzer;
  const claudeReviewService =
    config.claudeReviewService ?? defaultClaudeReviewService;

  const errors: ReviewError[] = [];
  const tasks: TaskInfo[] = [];
  let workspaces: Workspace[] = [];
  let branchStatuses: RepoBranchStatus[] = [];
  let diffAnalysis: DiffAnalysis | undefined;
  let projectContext: ProjectContext | undefined;
  let conflicts: Conflict[] = [];
  let codeIssues: CodeIssue[] = [];
  let claudeReview: ReviewResults = {
    summary: '',
    comments: [],
    fileHashMap: {},
    success: false,
  };

  // Step 1: Fetch task information
  onProgress?.(createProgress('fetch-tasks', 0));
  try {
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      try {
        const task: Task = await tasksApi.getById(taskId);
        const taskWorkspaces = await attemptsApi.getAll(taskId);

        tasks.push({
          id: task.id,
          title: task.title,
          description: task.description,
          workspaceId: taskWorkspaces[0]?.id,
          branch: taskWorkspaces[0]?.branch,
        });

        workspaces = workspaces.concat(taskWorkspaces);

        onProgress?.(
          createProgress(
            'fetch-tasks',
            Math.round(((i + 1) / taskIds.length) * 100)
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          step: 'fetch-tasks',
          message: `Failed to fetch task ${taskId}: ${message}`,
          recoverable: true,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'fetch-tasks',
      message: `Failed to fetch tasks: ${message}`,
      recoverable: false,
    });
  }

  // Step 2: Extract git diffs
  onProgress?.(createProgress('extract-diffs', 0));
  try {
    const allDiffs: Diff[] = [];
    let totalFilesChanged = 0;
    let totalLinesAdded = 0;
    let totalLinesDeleted = 0;
    const hotspotMap = new Map<string, number>();

    for (let i = 0; i < workspaces.length; i++) {
      const workspace = workspaces[i];
      try {
        const analysis = await gitDiffAnalyzer.analyzeDiffs(workspace.id);
        allDiffs.push(...analysis.diffs);
        totalFilesChanged += analysis.filesChanged;
        totalLinesAdded += analysis.linesAdded;
        totalLinesDeleted += analysis.linesDeleted;

        // Track hotspots
        for (const hotspot of analysis.hotspots) {
          hotspotMap.set(hotspot, (hotspotMap.get(hotspot) ?? 0) + 1);
        }

        // Also fetch branch status for conflict detection
        try {
          const statuses = await attemptsApi.getBranchStatus(workspace.id);
          branchStatuses = branchStatuses.concat(statuses);
        } catch {
          // Branch status fetch failed, continue anyway
        }

        onProgress?.(
          createProgress(
            'extract-diffs',
            Math.round(((i + 1) / workspaces.length) * 100)
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          step: 'extract-diffs',
          message: `Failed to extract diffs for workspace ${workspace.id}: ${message}`,
          recoverable: true,
        });
      }
    }

    // Sort hotspots by frequency
    const sortedHotspots = [...hotspotMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path]) => path);

    diffAnalysis = {
      diffs: allDiffs,
      filesChanged: totalFilesChanged,
      linesAdded: totalLinesAdded,
      linesDeleted: totalLinesDeleted,
      hotspots: sortedHotspots,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'extract-diffs',
      message: `Failed to extract diffs: ${message}`,
      recoverable: true,
    });
  }

  // Step 3: Get project context
  onProgress?.(createProgress('get-context', 0));
  try {
    if (tasks.length > 0) {
      // Get project ID from first task
      const firstTask = await tasksApi.getById(taskIds[0]);
      const workspaceIds = workspaces.map((w) => w.id);
      projectContext = await projectContextProvider.getContext(
        firstTask.project_id,
        workspaceIds
      );
      onProgress?.(createProgress('get-context', 100));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'get-context',
      message: `Failed to get project context: ${message}`,
      recoverable: true,
    });
  }

  // Step 4: Detect conflicts
  onProgress?.(createProgress('detect-conflicts', 0));
  try {
    conflicts = conflictDetector.detectConflicts(branchStatuses);
    onProgress?.(createProgress('detect-conflicts', 100));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'detect-conflicts',
      message: `Failed to detect conflicts: ${message}`,
      recoverable: true,
    });
  }

  // Step 5: Analyze code quality
  onProgress?.(createProgress('analyze-quality', 0));
  try {
    if (diffAnalysis) {
      codeIssues = await codeQualityAnalyzer.analyzeQuality(diffAnalysis.diffs);
    }
    onProgress?.(createProgress('analyze-quality', 100));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'analyze-quality',
      message: `Failed to analyze code quality: ${message}`,
      recoverable: true,
    });
  }

  // Step 6: Claude review
  onProgress?.(createProgress('claude-review', 0));
  try {
    if (diffAnalysis && projectContext) {
      claudeReview = await claudeReviewService.conductReview(
        diffAnalysis.diffs,
        projectContext,
        conflicts,
        codeIssues
      );
    }
    onProgress?.(createProgress('claude-review', 100));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      step: 'claude-review',
      message: `Failed to conduct Claude review: ${message}`,
      recoverable: true,
    });
    claudeReview = {
      summary: '',
      comments: [],
      fileHashMap: {},
      success: false,
      error: message,
    };
  }

  // Step 7 & 8: Aggregate and generate report
  onProgress?.(createProgress('aggregate', 0));

  const overallStatus = determineOverallStatus(
    conflicts,
    codeIssues,
    claudeReview
  );

  const summary = generateSummary(
    tasks,
    conflicts,
    codeIssues,
    claudeReview,
    overallStatus
  );

  onProgress?.(createProgress('aggregate', 100));

  return {
    taskCount: tasks.length,
    conflicts,
    codeIssues,
    claudeReview,
    overallStatus,
    summary,
    timestamp: new Date(),
    tasks,
    diffAnalysis,
    projectContext,
    errors,
  };
}

// ============================================================================
// Utility Exports
// ============================================================================

export { STEP_ORDER, STEP_DESCRIPTIONS };

export default {
  conductReview,
};
