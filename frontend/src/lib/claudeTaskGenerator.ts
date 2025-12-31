import Anthropic from '@anthropic-ai/sdk';

// TypeScript interfaces
export interface ProjectContext {
  projectName?: string;
  projectDescription?: string;
  technologies?: string[];
  existingTasks?: string[];
  additionalContext?: string;
}

export interface GenerateTaskInput {
  userInput: string;
  projectContext?: ProjectContext;
}

export interface GenerateTaskOutput {
  title: string;
  prompt: string;
}

// Custom error classes for specific error types
export class ClaudeApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_API_KEY'
      | 'API_FAILURE'
      | 'RATE_LIMITED'
      | 'NETWORK_ERROR'
      | 'PARSE_ERROR',
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'ClaudeApiError';
  }
}

// Build system prompt for task generation
function buildSystemPrompt(projectContext?: ProjectContext): string {
  let systemPrompt = `You are a helpful assistant that generates structured task definitions for a project management system.

Given a user's description of what they want to accomplish, generate:
1. A concise, descriptive title (max 80 characters)
2. A detailed prompt that can be used by a coding agent to implement the task

Your response must be valid JSON in this exact format:
{
  "title": "Brief descriptive title",
  "prompt": "Detailed implementation prompt..."
}`;

  if (projectContext) {
    systemPrompt += '\n\nProject context:';
    if (projectContext.projectName) {
      systemPrompt += `\n- Project name: ${projectContext.projectName}`;
    }
    if (projectContext.projectDescription) {
      systemPrompt += `\n- Description: ${projectContext.projectDescription}`;
    }
    if (projectContext.technologies?.length) {
      systemPrompt += `\n- Technologies: ${projectContext.technologies.join(', ')}`;
    }
    if (projectContext.existingTasks?.length) {
      systemPrompt += `\n- Existing tasks: ${projectContext.existingTasks.slice(0, 10).join(', ')}`;
    }
    if (projectContext.additionalContext) {
      systemPrompt += `\n- Additional context: ${projectContext.additionalContext}`;
    }
  }

  return systemPrompt;
}

// Parse Claude's response to extract title and prompt
function parseClaudeResponse(content: string): GenerateTaskOutput {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ClaudeApiError(
      'Failed to parse response: no JSON object found',
      'PARSE_ERROR'
    );
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
      throw new ClaudeApiError(
        'Invalid response: missing or empty title',
        'PARSE_ERROR'
      );
    }

    if (typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) {
      throw new ClaudeApiError(
        'Invalid response: missing or empty prompt',
        'PARSE_ERROR'
      );
    }

    return {
      title: parsed.title.trim(),
      prompt: parsed.prompt.trim(),
    };
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }
    throw new ClaudeApiError(
      `Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'PARSE_ERROR',
      error
    );
  }
}

// Check if error is a rate limit error
function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { status?: number; error?: { type?: string } };
    return (
      err.status === 429 || err.error?.type === 'rate_limit_error'
    );
  }
  return false;
}

// Check if error is a network error
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  if (error && typeof error === 'object') {
    const err = error as { code?: string };
    return (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'ETIMEDOUT'
    );
  }
  return false;
}

// Main service object following the project's API pattern
export const claudeTaskGeneratorApi = {
  /**
   * Generate a task title and prompt from user input using Claude API
   */
  generateTask: async (input: GenerateTaskInput): Promise<GenerateTaskOutput> => {
    // Check for API key
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ClaudeApiError(
        'Missing ANTHROPIC_API_KEY environment variable. Set VITE_ANTHROPIC_API_KEY in your .env file.',
        'MISSING_API_KEY'
      );
    }

    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });

    const systemPrompt = buildSystemPrompt(input.projectContext);

    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: input.userInput,
          },
        ],
      });

      // Extract text content from the response
      const textContent = message.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new ClaudeApiError(
          'No text content in Claude response',
          'API_FAILURE'
        );
      }

      return parseClaudeResponse(textContent.text);
    } catch (error) {
      // Re-throw if already a ClaudeApiError
      if (error instanceof ClaudeApiError) {
        throw error;
      }

      // Handle rate limiting
      if (isRateLimitError(error)) {
        throw new ClaudeApiError(
          'Rate limit exceeded. Please wait before making more requests.',
          'RATE_LIMITED',
          error
        );
      }

      // Handle network errors
      if (isNetworkError(error)) {
        throw new ClaudeApiError(
          'Network error while connecting to Claude API. Please check your connection.',
          'NETWORK_ERROR',
          error
        );
      }

      // Handle other API errors
      throw new ClaudeApiError(
        `Claude API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'API_FAILURE',
        error
      );
    }
  },
};
