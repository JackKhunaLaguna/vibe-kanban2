import type { Diff, Task } from 'shared/types';

/**
 * Data about a single task's diff for multi-task review
 */
export interface TaskDiffData {
  /** The task being reviewed */
  task: Task;
  /** Git diffs from this task's work */
  diffs: Diff[];
  /** The branch name for this task */
  branchName: string;
}

/**
 * Project context for the review
 */
export interface ProjectContext {
  /** Project name */
  name: string;
  /** Tech stack (e.g., "React, TypeScript, Node.js") */
  techStack?: string;
  /** Coding conventions or style notes */
  conventions?: string;
  /** Any additional project-specific context */
  additionalContext?: string;
}

/**
 * Severity level for identified issues
 */
export type IssueSeverity = 'critical' | 'major' | 'minor';

/**
 * Type of issue identified during review
 */
export type IssueType = 'file-conflict' | 'logic-conflict' | 'code-quality';

/**
 * A proposed fix for an identified issue
 */
export interface ProposedFix {
  /** Description of the fix */
  description: string;
  /** Which task should apply the fix (if applicable) */
  targetTask?: string;
  /** Suggested code changes or approach */
  suggestion?: string;
}

/**
 * A single issue identified during review
 */
export interface ReviewIssue {
  /** Unique identifier for this issue */
  id: string;
  /** Severity of the issue */
  severity: IssueSeverity;
  /** Type of issue */
  type: IssueType;
  /** Human-readable description of the issue */
  description: string;
  /** Task IDs affected by this issue */
  affectedTasks: string[];
  /** File paths affected by this issue */
  affectedFiles: string[];
  /** Proposed fix for this issue */
  proposedFix: ProposedFix;
}

/**
 * Summary of the review results
 */
export interface ReviewSummary {
  /** Total number of tasks reviewed */
  totalTasks: number;
  /** Total number of files changed across all tasks */
  totalFilesChanged: number;
  /** Count of issues by severity */
  issuesBySeverity: {
    critical: number;
    major: number;
    minor: number;
  };
  /** Overall assessment */
  overallAssessment: string;
}

/**
 * Complete review result structure
 */
export interface ReviewResult {
  /** Summary of the review */
  summary: ReviewSummary;
  /** List of identified issues */
  issues: ReviewIssue[];
}

// Constants for diff size limits
const MAX_DIFF_CONTENT_LENGTH = 50000;
const MAX_TOTAL_PROMPT_LENGTH = 150000;
const TRUNCATION_MESSAGE = '\n... [content truncated for length] ...';

/**
 * Summarizes a diff when it's too large to include in full
 */
function summarizeDiff(diff: Diff): string {
  const change = diff.change;
  const path = diff.newPath || diff.oldPath || 'unknown';
  const additions = diff.additions ?? 0;
  const deletions = diff.deletions ?? 0;

  let summary = `[${change.toUpperCase()}] ${path}`;

  if (additions > 0 || deletions > 0) {
    summary += ` (+${additions}, -${deletions} lines)`;
  }

  if (diff.contentOmitted) {
    summary += ' [content omitted - file too large]';
  }

  return summary;
}

/**
 * Formats a single diff for inclusion in the prompt
 */
function formatDiff(diff: Diff, maxLength: number): string {
  const path = diff.newPath || diff.oldPath || 'unknown';
  const header = `### ${diff.change.toUpperCase()}: ${path}`;

  // If content is omitted or not available, just show the summary
  if (diff.contentOmitted || (!diff.oldContent && !diff.newContent)) {
    return `${header}\n${summarizeDiff(diff)}`;
  }

  const oldContent = diff.oldContent || '';
  const newContent = diff.newContent || '';

  // Check if we need to truncate
  const contentLength = oldContent.length + newContent.length;
  if (contentLength > maxLength) {
    return `${header}\n${summarizeDiff(diff)}\n[Full diff too large to include - ${contentLength} characters]`;
  }

  // Build the diff representation
  const parts: string[] = [header];

  if (diff.change === 'modified' || diff.change === 'deleted') {
    parts.push('#### Previous content:');
    parts.push('```');
    parts.push(oldContent);
    parts.push('```');
  }

  if (diff.change === 'modified' || diff.change === 'added') {
    parts.push('#### New content:');
    parts.push('```');
    parts.push(newContent);
    parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Formats all diffs for a single task
 */
function formatTaskDiffs(
  taskDiff: TaskDiffData,
  maxLengthPerDiff: number
): string {
  const { task, diffs, branchName } = taskDiff;

  const header = `
## Task: ${task.title}
- **Task ID**: ${task.id}
- **Branch**: ${branchName}
- **Status**: ${task.status}
- **Files Changed**: ${diffs.length}
${task.description ? `- **Description**: ${task.description}` : ''}
`;

  if (diffs.length === 0) {
    return `${header}\n*No file changes in this task.*`;
  }

  const formattedDiffs = diffs
    .map((diff) => formatDiff(diff, maxLengthPerDiff))
    .join('\n\n');

  return `${header}\n${formattedDiffs}`;
}

/**
 * Builds a comprehensive prompt for Claude Code to review multiple tasks.
 *
 * The prompt includes clear instructions, project context, all task diffs,
 * and specifies the required JSON output format. It explicitly instructs
 * Claude Code to only identify issues without applying fixes.
 *
 * @param taskDiffs - Array of task diff data to review
 * @param projectContext - Optional project context for better review accuracy
 * @returns The constructed review prompt string
 */
export function buildReviewPrompt(
  taskDiffs: TaskDiffData[],
  projectContext?: ProjectContext
): string {
  if (taskDiffs.length === 0) {
    throw new Error('At least one task diff is required for review');
  }

  // Calculate how much space we have for diffs
  const systemInstructionsLength = 3000; // Approximate overhead for instructions
  const outputFormatLength = 1500; // Approximate overhead for output format
  const availableForDiffs =
    MAX_TOTAL_PROMPT_LENGTH - systemInstructionsLength - outputFormatLength;
  const maxLengthPerDiff = Math.floor(
    availableForDiffs / (taskDiffs.reduce((sum, t) => sum + t.diffs.length, 0) || 1)
  );
  const effectiveMaxPerDiff = Math.min(maxLengthPerDiff, MAX_DIFF_CONTENT_LENGTH);

  // Build the prompt sections
  const sections: string[] = [];

  // 1. System instructions
  sections.push(`# Multi-Task Code Review Request

You are reviewing code changes from multiple tasks that will potentially be merged into the same codebase.
Your goal is to identify conflicts, issues, and problems that could arise when these changes are integrated.

**IMPORTANT**: Do NOT apply fixes yet. Only identify issues and propose solutions.`);

  // 2. Project context
  if (projectContext) {
    const contextParts: string[] = ['## Project Context'];
    contextParts.push(`- **Project Name**: ${projectContext.name}`);
    if (projectContext.techStack) {
      contextParts.push(`- **Tech Stack**: ${projectContext.techStack}`);
    }
    if (projectContext.conventions) {
      contextParts.push(`- **Coding Conventions**: ${projectContext.conventions}`);
    }
    if (projectContext.additionalContext) {
      contextParts.push(`- **Additional Context**: ${projectContext.additionalContext}`);
    }
    sections.push(contextParts.join('\n'));
  }

  // 3. Review requirements
  sections.push(`## Review Requirements

Please analyze all task diffs below and identify:

1. **File Conflicts**: Multiple tasks modifying the same file or overlapping code sections
2. **Logic Conflicts**: Changes that could conflict semantically (e.g., one task adds a feature another removes)
3. **Code Quality Issues**: Problems with the changes themselves (bugs, security issues, performance)
4. **Integration Problems**: Issues that might arise when merging all changes together

For each issue found, assess severity:
- **critical**: Will cause build failures, runtime errors, or data loss
- **major**: Significant problems that should be fixed before merge
- **minor**: Style issues, minor improvements, or low-priority concerns`);

  // 4. Task diffs
  sections.push(`## Tasks Under Review (${taskDiffs.length} total)`);

  for (const taskDiff of taskDiffs) {
    sections.push(formatTaskDiffs(taskDiff, effectiveMaxPerDiff));
  }

  // 5. Output format specification
  sections.push(`## Required Output Format

You MUST respond with valid JSON in exactly this format:

\`\`\`json
{
  "summary": {
    "totalTasks": ${taskDiffs.length},
    "totalFilesChanged": <number>,
    "issuesBySeverity": {
      "critical": <number>,
      "major": <number>,
      "minor": <number>
    },
    "overallAssessment": "<brief overall assessment>"
  },
  "issues": [
    {
      "id": "<unique-id>",
      "severity": "critical|major|minor",
      "type": "file-conflict|logic-conflict|code-quality",
      "description": "<detailed description of the issue>",
      "affectedTasks": ["<task-id-1>", "<task-id-2>"],
      "affectedFiles": ["<file-path-1>", "<file-path-2>"],
      "proposedFix": {
        "description": "<how to fix this issue>",
        "targetTask": "<task-id that should apply the fix, if applicable>",
        "suggestion": "<specific code or approach suggestion>"
      }
    }
  ]
}
\`\`\`

If no issues are found, return an empty issues array with appropriate summary counts of 0.`);

  // 6. Final reminder
  sections.push(`## Final Instructions

1. Review all diffs thoroughly for conflicts and issues
2. Consider how changes from different tasks might interact
3. Be specific about file paths and line numbers where possible
4. Provide actionable fix suggestions
5. **Do NOT apply fixes** - only identify and propose solutions

Respond with the JSON output only, no additional commentary.`);

  // Join all sections
  let prompt = sections.join('\n\n');

  // Final length check and truncation if needed
  if (prompt.length > MAX_TOTAL_PROMPT_LENGTH) {
    prompt = prompt.slice(0, MAX_TOTAL_PROMPT_LENGTH - TRUNCATION_MESSAGE.length);
    prompt += TRUNCATION_MESSAGE;
  }

  return prompt;
}

/**
 * Parses the review result from Claude Code's JSON response
 */
export function parseReviewResult(jsonResponse: string): ReviewResult {
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonString = jsonResponse.trim();

    // Remove markdown code block if present
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonString) as ReviewResult;

    // Validate the structure
    if (!result.summary || !Array.isArray(result.issues)) {
      throw new Error('Invalid review result structure');
    }

    return result;
  } catch (error) {
    throw new Error(
      `Failed to parse review result: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
