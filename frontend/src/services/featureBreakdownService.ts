/**
 * Feature Breakdown Service
 *
 * Uses Claude API to break down feature descriptions into multiple tasks
 * with dependencies and execution tiers.
 */

// Types for the feature breakdown service
export interface ProjectContext {
  techStack?: string[];
  conventions?: string[];
  projectName?: string;
  existingPatterns?: string[];
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface TaskBreakdown {
  id: string;
  title: string;
  prompt: string;
  dependencies: string[];
  tier: number;
  estimatedTime: string;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface ExecutionPlan {
  [tier: string]: string[];
}

export interface FeatureBreakdown {
  featureName: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  totalTasks: number;
  tasks: TaskBreakdown[];
  executionPlan: ExecutionPlan;
}

// Claude API types
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: ClaudeMessage[];
}

interface ClaudeContentBlock {
  type: 'text';
  text: string;
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
}

interface ClaudeErrorResponse {
  error: {
    type: string;
    message: string;
  };
}

// Custom error types
export class FeatureBreakdownError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'FeatureBreakdownError';
  }
}

export class RateLimitError extends FeatureBreakdownError {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class InvalidResponseError extends FeatureBreakdownError {
  constructor(message: string, public rawResponse?: string) {
    super(message, 'INVALID_RESPONSE');
    this.name = 'InvalidResponseError';
  }
}

// Constants
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;

/**
 * Constructs the system prompt for Claude
 */
function buildSystemPrompt(projectContext?: ProjectContext): string {
  let contextSection = '';

  if (projectContext) {
    const parts: string[] = [];

    if (projectContext.projectName) {
      parts.push(`Project: ${projectContext.projectName}`);
    }

    if (projectContext.techStack && projectContext.techStack.length > 0) {
      parts.push(`Tech Stack: ${projectContext.techStack.join(', ')}`);
    }

    if (projectContext.conventions && projectContext.conventions.length > 0) {
      parts.push(`Conventions: ${projectContext.conventions.join(', ')}`);
    }

    if (
      projectContext.existingPatterns &&
      projectContext.existingPatterns.length > 0
    ) {
      parts.push(
        `Existing Patterns: ${projectContext.existingPatterns.join(', ')}`
      );
    }

    if (parts.length > 0) {
      contextSection = `

PROJECT CONTEXT:
${parts.join('\n')}`;
    }
  }

  return `You are an expert software architect and project planner. Your role is to break down feature descriptions into well-structured, actionable tasks that can be executed by an AI coding assistant (Claude Code).
${contextSection}

GUIDELINES FOR TASK BREAKDOWN:

1. TASK IDENTIFICATION:
   - Break the feature into discrete, atomic tasks
   - Each task should be completable independently once dependencies are met
   - Include setup, implementation, testing, and integration tasks as needed

2. TASK STRUCTURE:
   - Each task needs a unique ID (e.g., "task-1", "task-2")
   - Title should be concise and actionable, starting with a verb
   - Prompt should be comprehensive enough for Claude Code to implement
   - Prompts should include specific file paths, function signatures, and acceptance criteria when possible

3. DEPENDENCIES:
   - Identify which tasks depend on others
   - A task should only list direct dependencies (not transitive ones)
   - Tasks with no dependencies can be in tier 1

4. EXECUTION TIERS:
   - Tier 1: Tasks with no dependencies (can run in parallel)
   - Tier 2: Tasks that depend only on tier 1 tasks
   - Tier 3+: Continue the pattern
   - Organize the execution plan by tiers

5. COMPLEXITY ESTIMATION:
   - simple: Quick changes, single file, straightforward logic
   - moderate: Multiple files, some logic complexity, or integration work
   - complex: Significant changes, complex logic, multiple integrations

6. TIME ESTIMATION:
   - Provide realistic time estimates (e.g., "15 minutes", "1 hour", "2-3 hours")
   - Base estimates on the complexity and scope of each task

You MUST respond with valid JSON in exactly this format:
{
  "featureName": "Human-readable name for the feature",
  "estimatedComplexity": "low" | "medium" | "high",
  "totalTasks": <number>,
  "tasks": [
    {
      "id": "task-1",
      "title": "Verb-starting concise title",
      "prompt": "Detailed prompt for Claude Code with specific requirements, file paths, and acceptance criteria",
      "dependencies": [],
      "tier": 1,
      "estimatedTime": "30 minutes",
      "complexity": "simple" | "moderate" | "complex"
    }
  ],
  "executionPlan": {
    "tier1": ["task-1", "task-2"],
    "tier2": ["task-3"],
    "tier3": ["task-4"]
  }
}`;
}

/**
 * Constructs the user message for Claude
 */
function buildUserMessage(
  description: string,
  conversationHistory?: Message[]
): string {
  let message = '';

  // Include conversation history if refining
  if (conversationHistory && conversationHistory.length > 0) {
    message += 'CONVERSATION HISTORY:\n';
    for (const msg of conversationHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      message += `${role}: ${msg.content}\n\n`;
    }
    message += '---\n\n';
    message +=
      'Based on the conversation above, provide an updated feature breakdown:\n\n';
  } else {
    message += 'Break down this feature into tasks:\n\n';
  }

  message += description;

  return message;
}

/**
 * Parse and validate the Claude response
 */
function parseResponse(text: string): FeatureBreakdown {
  // Try to extract JSON from the response
  let jsonStr = text.trim();

  // Handle case where response might have markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new InvalidResponseError(
      `Failed to parse JSON response: ${e instanceof Error ? e.message : 'Unknown error'}`,
      text
    );
  }

  // Validate the structure
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('featureName' in parsed) ||
    !('tasks' in parsed)
  ) {
    throw new InvalidResponseError(
      'Response missing required fields: featureName, tasks',
      text
    );
  }

  const result = parsed as Record<string, unknown>;

  // Validate featureName
  if (typeof result.featureName !== 'string') {
    throw new InvalidResponseError('featureName must be a string', text);
  }

  // Validate estimatedComplexity
  const validComplexities = ['low', 'medium', 'high'];
  if (
    typeof result.estimatedComplexity !== 'string' ||
    !validComplexities.includes(result.estimatedComplexity)
  ) {
    throw new InvalidResponseError(
      'estimatedComplexity must be low, medium, or high',
      text
    );
  }

  // Validate tasks array
  if (!Array.isArray(result.tasks)) {
    throw new InvalidResponseError('tasks must be an array', text);
  }

  // Validate each task
  for (const task of result.tasks) {
    if (!task || typeof task !== 'object') {
      throw new InvalidResponseError('Each task must be an object', text);
    }

    const requiredFields = [
      'id',
      'title',
      'prompt',
      'dependencies',
      'tier',
      'estimatedTime',
      'complexity',
    ];
    for (const field of requiredFields) {
      if (!(field in task)) {
        throw new InvalidResponseError(
          `Task missing required field: ${field}`,
          text
        );
      }
    }

    if (!Array.isArray(task.dependencies)) {
      throw new InvalidResponseError('task.dependencies must be an array', text);
    }

    const validTaskComplexities = ['simple', 'moderate', 'complex'];
    if (!validTaskComplexities.includes(task.complexity)) {
      throw new InvalidResponseError(
        'task.complexity must be simple, moderate, or complex',
        text
      );
    }
  }

  // Validate executionPlan
  if (result.executionPlan && typeof result.executionPlan !== 'object') {
    throw new InvalidResponseError('executionPlan must be an object', text);
  }

  return {
    featureName: result.featureName as string,
    estimatedComplexity: result.estimatedComplexity as
      | 'low'
      | 'medium'
      | 'high',
    totalTasks:
      typeof result.totalTasks === 'number'
        ? result.totalTasks
        : (result.tasks as unknown[]).length,
    tasks: result.tasks as TaskBreakdown[],
    executionPlan: (result.executionPlan as ExecutionPlan) || {},
  };
}

/**
 * Get the API key from environment
 */
function getApiKey(): string {
  // In browser context, get API key from localStorage or window global
  const apiKey =
    localStorage.getItem('ANTHROPIC_API_KEY') ||
    (window as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new FeatureBreakdownError(
      'ANTHROPIC_API_KEY is not configured',
      'MISSING_API_KEY'
    );
  }

  return apiKey;
}

/**
 * Break down a feature description into multiple tasks with dependencies.
 *
 * @param description - The feature description to break down
 * @param projectContext - Optional project context (tech stack, conventions)
 * @param conversationHistory - Optional conversation history for refinement
 * @returns Promise<FeatureBreakdown> - The structured breakdown of tasks
 */
export async function breakdownFeature(
  description: string,
  projectContext?: ProjectContext,
  conversationHistory?: Message[]
): Promise<FeatureBreakdown> {
  const apiKey = getApiKey();

  const systemPrompt = buildSystemPrompt(projectContext);
  const userMessage = buildUserMessage(description, conversationHistory);

  const request: ClaudeRequest = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  };

  let response: Response;

  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new FeatureBreakdownError(
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR'
    );
  }

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    throw new RateLimitError(
      'Rate limit exceeded. Please try again later.',
      retryAfter ? parseInt(retryAfter, 10) : undefined
    );
  }

  // Handle other errors
  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;

    try {
      const errorBody: ClaudeErrorResponse = await response.json();
      if (errorBody.error?.message) {
        errorMessage = errorBody.error.message;
      }
    } catch {
      // Use default error message
    }

    throw new FeatureBreakdownError(
      errorMessage,
      'API_ERROR',
      response.status
    );
  }

  // Parse the response
  let claudeResponse: ClaudeResponse;
  try {
    claudeResponse = await response.json();
  } catch {
    throw new InvalidResponseError('Failed to parse API response as JSON');
  }

  // Extract text from content blocks
  const textBlock = claudeResponse.content.find(
    (block) => block.type === 'text'
  );
  if (!textBlock) {
    throw new InvalidResponseError('No text content in API response');
  }

  // Parse and validate the feature breakdown
  return parseResponse(textBlock.text);
}
