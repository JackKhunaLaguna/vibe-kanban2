/**
 * Claude API integration for orchestrator conversations.
 *
 * This service provides the ability to interact with Claude API for
 * orchestrating task management, code reviews, and other workflow operations.
 */

import type { TaskStatus } from 'shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Task summary for orchestrator context
 */
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  hasActiveAttempt: boolean;
}

/**
 * Active orchestration information
 */
export interface ActiveOrchestrationInfo {
  isActive: boolean;
  currentWave?: number;
  totalWaves?: number;
  tasksInProgress?: string[];
}

/**
 * User preferences for orchestrator context
 */
export interface UserPreferences {
  autoStartTasks: boolean;
  requireApprovalForPRs: boolean;
  preferredReviewStyle: 'thorough' | 'quick' | 'balanced';
  maxConcurrentTasks: number;
}

/**
 * Project patterns for orchestrator context
 */
export interface ProjectPatterns {
  codeStyle: string;
  testingApproach: string;
  branchingStrategy: string;
  prTemplate?: string;
}

/**
 * Conversation message for history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * Context provided to the orchestrator
 */
export interface OrchestratorContext {
  /** Tasks grouped by status */
  tasks: {
    todo: TaskSummary[];
    inProgress: TaskSummary[];
    inReview: TaskSummary[];
    done: TaskSummary[];
  };
  /** Active orchestration state */
  activeOrchestration: ActiveOrchestrationInfo;
  /** User preferences */
  preferences: UserPreferences;
  /** Project patterns */
  patterns: ProjectPatterns;
  /** Recent conversation history */
  conversationHistory: ConversationMessage[];
}

/**
 * Action types the orchestrator can suggest
 */
export type ActionType =
  | 'start_wave'
  | 'trigger_review'
  | 'create_pr'
  | 'create_task';

/**
 * Suggested action from the orchestrator
 */
export interface Action {
  type: ActionType;
  data: Record<string, unknown>;
  requiresApproval: boolean;
}

/**
 * Action button for UI rendering
 */
export interface ActionButton {
  label: string;
  action: ActionType;
  variant: 'primary' | 'secondary' | 'destructive';
  data?: Record<string, unknown>;
}

/**
 * Response from the orchestrator
 */
export interface OrchestratorResponse {
  message: string;
  suggestedActions?: Action[];
  needsUserDecision: boolean;
  actionButtons?: ActionButton[];
}

// ============================================================================
// Constants
// ============================================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Error Classes
// ============================================================================

export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'API_ERROR'
      | 'PARSE_ERROR'
      | 'NETWORK_ERROR',
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Anthropic API key from environment or configuration
 */
function getApiKey(): string {
  // In a browser environment, the API key should be provided via
  // environment variables at build time or through a secure backend proxy
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new OrchestratorError(
      'ANTHROPIC_API_KEY is not configured',
      'MISSING_API_KEY'
    );
  }

  return apiKey;
}

/**
 * Format tasks for the prompt
 */
function formatTasks(tasks: TaskSummary[]): string {
  if (tasks.length === 0) {
    return 'None';
  }

  return tasks
    .map((task) => `- ${task.title}${task.hasActiveAttempt ? ' (active)' : ''}`)
    .join('\n');
}

/**
 * Format user preferences for the prompt
 */
function formatPreferences(preferences: UserPreferences): string {
  return `- Auto-start tasks: ${preferences.autoStartTasks ? 'Yes' : 'No'}
- Require approval for PRs: ${preferences.requireApprovalForPRs ? 'Yes' : 'No'}
- Preferred review style: ${preferences.preferredReviewStyle}
- Max concurrent tasks: ${preferences.maxConcurrentTasks}`;
}

/**
 * Format project patterns for the prompt
 */
function formatPatterns(patterns: ProjectPatterns): string {
  return `- Code style: ${patterns.codeStyle}
- Testing approach: ${patterns.testingApproach}
- Branching strategy: ${patterns.branchingStrategy}${patterns.prTemplate ? `\n- PR template available: Yes` : ''}`;
}

/**
 * Format conversation history for the prompt
 */
function formatConversationHistory(
  history: ConversationMessage[]
): string {
  if (history.length === 0) {
    return 'No previous conversation';
  }

  // Limit to last 10 messages to keep context manageable
  const recentHistory = history.slice(-10);

  return recentHistory
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n\n');
}

/**
 * Format active orchestration info for the prompt
 */
function formatActiveOrchestration(info: ActiveOrchestrationInfo): string {
  if (!info.isActive) {
    return 'No active orchestration';
  }

  let result = `Active - Wave ${info.currentWave ?? 1}`;
  if (info.totalWaves) {
    result += ` of ${info.totalWaves}`;
  }
  if (info.tasksInProgress && info.tasksInProgress.length > 0) {
    result += `\nTasks in progress: ${info.tasksInProgress.join(', ')}`;
  }

  return result;
}

/**
 * Build the system prompt for the orchestrator
 */
function buildSystemPrompt(context: OrchestratorContext): string {
  const todoTasks = formatTasks(context.tasks.todo);
  const inProgressTasks = formatTasks(context.tasks.inProgress);
  const inReviewTasks = formatTasks(context.tasks.inReview);
  const activeInfo = formatActiveOrchestration(context.activeOrchestration);
  const formattedPreferences = formatPreferences(context.preferences);
  const formattedPatterns = formatPatterns(context.patterns);
  const conversationHistory = formatConversationHistory(
    context.conversationHistory
  );

  return `You are the AI Orchestrator for Vibe Kanban.

CURRENT STATE:
- Tasks in To Do:
${todoTasks}
- Tasks in Progress:
${inProgressTasks}
- Tasks in Review:
${inReviewTasks}
- Active orchestration: ${activeInfo}

USER PREFERENCES:
${formattedPreferences}

PROJECT PATTERNS:
${formattedPatterns}

CONVERSATION HISTORY:
${conversationHistory}

YOUR CAPABILITIES:
- Start orchestration (execute tasks in waves)
- Trigger code review
- Create pull requests
- Suggest new tasks
- Answer questions about state

Respond naturally and helpfully.

OUTPUT JSON:
{
  "message": "Your response",
  "suggestedActions": [...],
  "needsUserDecision": true/false,
  "actionButtons": [...]
}

IMPORTANT: You MUST respond with valid JSON matching the OUTPUT JSON format above. Do not include any text before or after the JSON object.`;
}

/**
 * Parse the orchestrator response from Claude's output
 */
function parseOrchestratorResponse(text: string): OrchestratorResponse {
  // Try to extract JSON from the response
  // Claude might wrap it in markdown code blocks or include extra text
  let jsonText = text.trim();

  // Remove markdown code blocks if present
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  // Try to find JSON object in the text
  const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    jsonText = jsonObjectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      message?: string;
      suggestedActions?: Action[];
      needsUserDecision?: boolean;
      actionButtons?: ActionButton[];
    };

    // Validate required fields
    if (typeof parsed.message !== 'string') {
      throw new Error('Response missing required "message" field');
    }

    return {
      message: parsed.message,
      suggestedActions: parsed.suggestedActions,
      needsUserDecision: parsed.needsUserDecision ?? false,
      actionButtons: parsed.actionButtons,
    };
  } catch (error) {
    // If JSON parsing fails, create a simple response with the raw text
    console.warn('Failed to parse orchestrator response as JSON:', error);
    return {
      message: text,
      needsUserDecision: false,
    };
  }
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Get a response from the AI orchestrator
 *
 * @param userMessage - The user's message to the orchestrator
 * @param context - The current orchestrator context
 * @returns The orchestrator's response
 * @throws OrchestratorError if the API call fails
 */
export async function getOrchestratorResponse(
  userMessage: string,
  context: OrchestratorContext
): Promise<OrchestratorResponse> {
  const apiKey = getApiKey();
  const systemPrompt = buildSystemPrompt(context);

  const requestBody = {
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user' as const,
        content: `USER MESSAGE: ${userMessage}`,
      },
    ],
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = `API request failed with status ${response.status}`;

        try {
          const errorJson = JSON.parse(errorBody) as {
            error?: { message?: string };
          };
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // Use default error message
        }

        // Don't retry on client errors (4xx) except rate limiting (429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new OrchestratorError(
            errorMessage,
            'API_ERROR',
            response.status
          );
        }

        throw new OrchestratorError(
          errorMessage,
          'API_ERROR',
          response.status
        );
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      // Extract text from the response
      const textContent = data.content?.find(
        (block) => block.type === 'text'
      );

      if (!textContent?.text) {
        throw new OrchestratorError(
          'No text content in API response',
          'PARSE_ERROR'
        );
      }

      return parseOrchestratorResponse(textContent.text);
    } catch (error) {
      lastError = error as Error;

      // If it's a non-retryable error, throw immediately
      if (
        error instanceof OrchestratorError &&
        error.code !== 'API_ERROR'
      ) {
        throw error;
      }

      // If we've exhausted retries, throw the last error
      if (attempt === MAX_RETRIES) {
        if (error instanceof OrchestratorError) {
          throw error;
        }
        throw new OrchestratorError(
          `Network error: ${(error as Error).message}`,
          'NETWORK_ERROR'
        );
      }

      // Exponential backoff for retries
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `Orchestrator API call failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`,
        error
      );
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new OrchestratorError('Unknown error', 'NETWORK_ERROR');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a default/empty orchestrator context
 */
export function createEmptyContext(): OrchestratorContext {
  return {
    tasks: {
      todo: [],
      inProgress: [],
      inReview: [],
      done: [],
    },
    activeOrchestration: {
      isActive: false,
    },
    preferences: {
      autoStartTasks: false,
      requireApprovalForPRs: true,
      preferredReviewStyle: 'balanced',
      maxConcurrentTasks: 3,
    },
    patterns: {
      codeStyle: 'Not specified',
      testingApproach: 'Not specified',
      branchingStrategy: 'Not specified',
    },
    conversationHistory: [],
  };
}

/**
 * Add a message to the conversation history
 */
export function addToConversationHistory(
  context: OrchestratorContext,
  role: 'user' | 'assistant',
  content: string
): OrchestratorContext {
  return {
    ...context,
    conversationHistory: [
      ...context.conversationHistory,
      {
        role,
        content,
        timestamp: new Date(),
      },
    ],
  };
}
