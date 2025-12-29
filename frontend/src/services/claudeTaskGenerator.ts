/**
 * Claude Task Generator Service
 *
 * This service handles communication with the backend API
 * to generate tasks using Claude AI.
 */

import { ApiError, handleApiResponse } from '@/lib/api';
import type { Project, TaskWithAttemptStatus } from 'shared/types';
import { getProjectContext } from './projectContextProvider';
import {
  buildTaskGenerationPrompt,
  parseTaskGenerationResponse,
  type GeneratedTask,
  type ProjectContext,
} from './taskGenerationPrompt';

export interface TaskGenerationRequest {
  userInput: string;
  projectId: string;
  context?: ProjectContext;
  maxTasks?: number;
}

export interface TaskGenerationResult {
  success: true;
  tasks: GeneratedTask[];
  reasoning?: string;
}

export interface TaskGenerationError {
  success: false;
  error: string;
  code: 'INVALID_INPUT' | 'API_ERROR' | 'PARSE_ERROR' | 'CONTEXT_ERROR';
}

export type TaskGenerationOutcome = TaskGenerationResult | TaskGenerationError;

/**
 * Logger for task generation operations.
 */
const log = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[ClaudeTaskGenerator] ${message}`, data ?? '');
  },
  error: (message: string, error?: unknown) => {
    console.error(`[ClaudeTaskGenerator] ${message}`, error ?? '');
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    if (import.meta.env.DEV) {
      console.debug(`[ClaudeTaskGenerator] ${message}`, data ?? '');
    }
  },
};

/**
 * Generates tasks using Claude AI based on user input and project context.
 *
 * @param request - The task generation request containing user input and project info
 * @returns Promise resolving to generated tasks or an error
 */
export async function generateTasks(
  request: TaskGenerationRequest
): Promise<TaskGenerationOutcome> {
  const { userInput, projectId, context, maxTasks = 5 } = request;

  log.info('Starting task generation', { projectId, inputLength: userInput.length });

  // Validate input
  if (!userInput || userInput.trim().length === 0) {
    log.error('Empty user input provided');
    return {
      success: false,
      error: 'User input cannot be empty',
      code: 'INVALID_INPUT',
    };
  }

  if (!projectId) {
    log.error('Missing project ID');
    return {
      success: false,
      error: 'Project ID is required',
      code: 'INVALID_INPUT',
    };
  }

  try {
    // Use provided context or fetch from projectContextProvider
    const projectContext = context ?? await fetchContext(projectId);

    if (!projectContext) {
      return {
        success: false,
        error: 'Failed to retrieve project context',
        code: 'CONTEXT_ERROR',
      };
    }

    // Build the prompt
    const prompt = buildTaskGenerationPrompt({
      userInput: userInput.trim(),
      context: projectContext,
      maxTasks,
    });

    log.debug('Built prompt', {
      systemLength: prompt.system.length,
      userLength: prompt.user.length,
    });

    // Call the backend API
    const response = await callGenerateApi({
      userInput: userInput.trim(),
      projectId,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
    });

    log.debug('Received API response', { responseLength: response.length });

    // Parse the response
    const parsed = parseTaskGenerationResponse(response);

    log.info('Task generation successful', { taskCount: parsed.tasks.length });

    return {
      success: true,
      tasks: parsed.tasks,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return handleGenerationError(error);
  }
}

/**
 * Fetches project context for task generation.
 */
async function fetchContext(projectId: string): Promise<ProjectContext | null> {
  try {
    // Note: This requires the project object and tasks.
    // In a real implementation, you would fetch these from the API or context.
    // For now, we'll create a minimal context.
    log.debug('Fetching minimal context for project', { projectId });
    return {
      projectId,
      projectName: 'Project', // This should be fetched from project state
      repositories: [],
    };
  } catch (error) {
    log.error('Failed to fetch project context', error);
    return null;
  }
}

/**
 * Calls the backend task generation API endpoint.
 */
async function callGenerateApi(params: {
  userInput: string;
  projectId: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const response = await fetch('/api/tasks/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new ApiError(
      `Task generation failed: ${errorText}`,
      response.status,
      response
    );
  }

  const result = await handleApiResponse<{ content: string }>(response);
  return result.content;
}

/**
 * Handles errors during task generation and returns appropriate error response.
 */
function handleGenerationError(error: unknown): TaskGenerationError {
  if (error instanceof ApiError) {
    log.error('API error during task generation', {
      status: error.status,
      message: error.message,
    });

    if (error.status === 400) {
      return {
        success: false,
        error: error.message || 'Invalid request',
        code: 'INVALID_INPUT',
      };
    }

    return {
      success: false,
      error: error.message || 'API request failed',
      code: 'API_ERROR',
    };
  }

  if (error instanceof Error && error.message.includes('parse')) {
    log.error('Parse error during task generation', error);
    return {
      success: false,
      error: error.message,
      code: 'PARSE_ERROR',
    };
  }

  log.error('Unexpected error during task generation', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'An unexpected error occurred',
    code: 'API_ERROR',
  };
}

/**
 * Convenience function to generate tasks with full project context.
 */
export async function generateTasksWithContext(
  userInput: string,
  project: Project,
  existingTasks?: TaskWithAttemptStatus[],
  maxTasks?: number
): Promise<TaskGenerationOutcome> {
  try {
    const context = await getProjectContext(project, existingTasks);

    return generateTasks({
      userInput,
      projectId: project.id,
      context,
      maxTasks,
    });
  } catch (error) {
    log.error('Failed to generate tasks with context', error);
    return {
      success: false,
      error: 'Failed to gather project context',
      code: 'CONTEXT_ERROR',
    };
  }
}

// Export types for consumers
export type {
  GeneratedTask,
  ProjectContext,
  TaskGenerationResponse,
} from './taskGenerationPrompt';
