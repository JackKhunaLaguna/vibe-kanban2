/**
 * Claude API service for code review analysis
 *
 * This service calls the Anthropic Claude API to perform code review analysis
 * on multiple tasks simultaneously, identifying conflicts, code quality issues,
 * and suggesting fixes.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes

// --- Types ---

export interface TaskDiff {
  taskId: string;
  taskTitle: string;
  filePath: string;
  diff: string;
  language?: string;
}

export interface ProjectContext {
  techStack: string[];
  conventions: string[];
  projectDescription?: string;
  branchName?: string;
}

export interface Conflict {
  taskId1: string;
  taskId2: string;
  filePath: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface CodeIssue {
  taskId: string;
  filePath: string;
  line?: number;
  issue: string;
  category: 'bug' | 'security' | 'performance' | 'style' | 'maintainability';
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface Fix {
  taskId: string;
  filePath: string;
  description: string;
  suggestedCode?: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ReviewResults {
  conflicts: Conflict[];
  codeQualityIssues: CodeIssue[];
  suggestedFixes: Fix[];
  overallAssessment: string;
}

// --- Error Types ---

export class ClaudeReviewError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'API_ERROR'
      | 'RATE_LIMITED'
      | 'TIMEOUT'
      | 'PARSE_ERROR'
      | 'NETWORK_ERROR',
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ClaudeReviewError';
  }
}

// --- API Request/Response Types ---

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Message[];
}

interface ContentBlock {
  type: 'text';
  text: string;
}

interface MessagesResponse {
  content: ContentBlock[];
}

interface ApiErrorResponse {
  error: {
    type: string;
    message: string;
  };
}

// --- Logging Utility ---

const log = {
  debug: (message: string, data?: unknown) => {
    console.debug(`[ClaudeReviewService] ${message}`, data ?? '');
  },
  info: (message: string, data?: unknown) => {
    console.info(`[ClaudeReviewService] ${message}`, data ?? '');
  },
  warn: (message: string, data?: unknown) => {
    console.warn(`[ClaudeReviewService] ${message}`, data ?? '');
  },
  error: (message: string, data?: unknown) => {
    console.error(`[ClaudeReviewService] ${message}`, data ?? '');
  },
};

// --- Prompt Construction ---

function buildReviewPrompt(
  tasks: TaskDiff[],
  projectContext: ProjectContext
): string {
  const techStackSection = projectContext.techStack.length
    ? `Tech Stack: ${projectContext.techStack.join(', ')}`
    : '';

  const conventionsSection = projectContext.conventions.length
    ? `Coding Conventions:\n${projectContext.conventions.map((c) => `- ${c}`).join('\n')}`
    : '';

  const projectDescSection = projectContext.projectDescription
    ? `Project Description: ${projectContext.projectDescription}`
    : '';

  const branchSection = projectContext.branchName
    ? `Branch: ${projectContext.branchName}`
    : '';

  const contextParts = [
    techStackSection,
    conventionsSection,
    projectDescSection,
    branchSection,
  ].filter(Boolean);

  const tasksSection = tasks
    .map(
      (task) => `
### Task: ${task.taskTitle} (ID: ${task.taskId})
File: ${task.filePath}${task.language ? ` (${task.language})` : ''}

\`\`\`diff
${task.diff}
\`\`\`
`
    )
    .join('\n');

  return `# Code Review Request

## Project Context
${contextParts.join('\n\n')}

## Tasks to Review
${tasksSection}

## Review Requirements

Please analyze all the task changes above and provide a comprehensive code review. Focus on:

1. **Conflicts**: Identify any conflicts between tasks that modify the same files or related functionality
2. **Code Quality Issues**: Find bugs, security vulnerabilities, performance issues, style violations, and maintainability concerns
3. **Suggested Fixes**: Provide actionable suggestions to improve the code

For each issue found, specify:
- Which task it relates to
- The file path and line number (if applicable)
- The severity level
- A clear description of the issue
- Suggested fix (with code snippets where helpful)`;
}

const SYSTEM_PROMPT = `You are an expert code reviewer performing a comprehensive analysis of code changes across multiple tasks.

Your role is to:
1. Identify conflicts between tasks modifying the same or related code
2. Find bugs, security vulnerabilities, and performance issues
3. Check for code style and maintainability problems
4. Suggest improvements with specific, actionable recommendations

You MUST respond with valid JSON in exactly this format:
{
  "conflicts": [
    {
      "taskId1": "task ID of first conflicting task",
      "taskId2": "task ID of second conflicting task",
      "filePath": "path/to/file.ts",
      "description": "Clear description of the conflict",
      "severity": "high" | "medium" | "low"
    }
  ],
  "codeQualityIssues": [
    {
      "taskId": "task ID",
      "filePath": "path/to/file.ts",
      "line": 42,
      "issue": "Description of the issue",
      "category": "bug" | "security" | "performance" | "style" | "maintainability",
      "severity": "critical" | "high" | "medium" | "low"
    }
  ],
  "suggestedFixes": [
    {
      "taskId": "task ID",
      "filePath": "path/to/file.ts",
      "description": "What should be fixed and how",
      "suggestedCode": "optional code snippet showing the fix",
      "priority": "high" | "medium" | "low"
    }
  ],
  "overallAssessment": "A brief summary of the overall code quality and main concerns"
}

Guidelines:
- Be thorough but prioritize significant issues over minor style nitpicks
- For security issues, always mark as high or critical severity
- Provide specific line numbers when possible
- Include code snippets in suggestedFixes when it helps clarify the fix
- If there are no conflicts or issues, return empty arrays
- The overallAssessment should be 2-4 sentences summarizing the review`;

// --- API Call ---

async function callClaudeApi(
  apiKey: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  log.debug('Calling Claude API', { model: DEFAULT_MODEL, maxTokens: MAX_TOKENS });

  const request: MessagesRequest = {
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  };

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.warn('Request timed out');
      throw new ClaudeReviewError(
        'Request timed out after ' + REQUEST_TIMEOUT_MS / 1000 + ' seconds',
        'TIMEOUT'
      );
    }
    log.error('Network error', error);
    throw new ClaudeReviewError(
      'Network error while calling Claude API',
      'NETWORK_ERROR',
      undefined,
      error
    );
  }

  const statusCode = response.status;

  if (!response.ok) {
    let errorMessage = `API request failed with status ${statusCode}`;
    let errorCode: ClaudeReviewError['code'] = 'API_ERROR';

    try {
      const errorBody: ApiErrorResponse = await response.json();
      errorMessage = errorBody.error?.message || errorMessage;

      // Check for rate limiting
      if (statusCode === 429) {
        errorCode = 'RATE_LIMITED';
        log.warn('Rate limited by Claude API', { statusCode, errorMessage });
      } else {
        log.error('API error response', { statusCode, errorMessage, errorBody });
      }
    } catch {
      log.error('Failed to parse error response', { statusCode });
    }

    throw new ClaudeReviewError(errorMessage, errorCode, statusCode);
  }

  const data: MessagesResponse = await response.json();

  const textContent = data.content.find((block) => block.type === 'text');
  if (!textContent) {
    log.error('No text content in response', data);
    throw new ClaudeReviewError(
      'No text content in API response',
      'PARSE_ERROR',
      undefined,
      data
    );
  }

  log.debug('Received response from Claude API');
  return textContent.text;
}

// --- Response Parsing ---

function parseReviewResponse(responseText: string): ReviewResults {
  log.debug('Parsing review response');

  // Try to extract JSON from the response (Claude sometimes wraps it in markdown)
  let jsonText = responseText;

  // Check if response is wrapped in markdown code block
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);

    // Validate the structure
    const results: ReviewResults = {
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      codeQualityIssues: Array.isArray(parsed.codeQualityIssues)
        ? parsed.codeQualityIssues
        : [],
      suggestedFixes: Array.isArray(parsed.suggestedFixes)
        ? parsed.suggestedFixes
        : [],
      overallAssessment:
        typeof parsed.overallAssessment === 'string'
          ? parsed.overallAssessment
          : 'No assessment provided.',
    };

    log.info('Review parsed successfully', {
      conflictsCount: results.conflicts.length,
      issuesCount: results.codeQualityIssues.length,
      fixesCount: results.suggestedFixes.length,
    });

    return results;
  } catch (error) {
    log.error('Failed to parse review response', { responseText, error });
    throw new ClaudeReviewError(
      `Failed to parse review response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'PARSE_ERROR',
      undefined,
      { responseText, error }
    );
  }
}

// --- Main Function ---

/**
 * Perform code review analysis on multiple tasks using Claude API
 *
 * @param tasks - Array of task diffs to review
 * @param projectContext - Context about the project (tech stack, conventions, etc.)
 * @param apiKey - Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
 * @returns ReviewResults with conflicts, code quality issues, and suggested fixes
 * @throws ClaudeReviewError on API errors, rate limiting, timeouts, or parse failures
 */
export async function reviewCode(
  tasks: TaskDiff[],
  projectContext: ProjectContext,
  apiKey?: string
): Promise<ReviewResults> {
  log.info('Starting code review', {
    taskCount: tasks.length,
    techStack: projectContext.techStack,
  });

  // Get API key from parameter or environment
  const key = apiKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) {
    log.error('Missing API key');
    throw new ClaudeReviewError(
      'ANTHROPIC_API_KEY is not configured. Set VITE_ANTHROPIC_API_KEY environment variable.',
      'MISSING_API_KEY'
    );
  }

  // Validate input
  if (!tasks.length) {
    log.warn('No tasks provided for review');
    return {
      conflicts: [],
      codeQualityIssues: [],
      suggestedFixes: [],
      overallAssessment: 'No tasks provided for review.',
    };
  }

  // Build the review prompt
  const prompt = buildReviewPrompt(tasks, projectContext);
  log.debug('Built review prompt', { promptLength: prompt.length });

  // Set up timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Call Claude API
    const responseText = await callClaudeApi(key, prompt, controller.signal);

    // Parse the response
    const results = parseReviewResponse(responseText);

    log.info('Code review completed successfully');
    return results;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default { reviewCode };
