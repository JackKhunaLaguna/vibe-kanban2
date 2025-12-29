/**
 * Task generation prompt template for Claude API.
 * This module provides utilities for building prompts to generate
 * structured task definitions from user input.
 */

export interface ProjectContext {
  projectId: string;
  projectName: string;
  repositories: Array<{
    id: string;
    name: string;
    path: string;
  }>;
  existingTasks?: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  tags?: Array<{
    name: string;
    content: string;
  }>;
}

export interface TaskGenerationPromptOptions {
  userInput: string;
  context: ProjectContext;
  maxTasks?: number;
}

export interface GeneratedTask {
  title: string;
  description: string | null;
  status: 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled';
  suggestedTags?: string[];
}

export interface TaskGenerationResponse {
  tasks: GeneratedTask[];
  reasoning?: string;
}

/**
 * System prompt for task generation.
 * Instructs Claude on how to generate structured task definitions.
 */
const SYSTEM_PROMPT = `You are a task generation assistant for a software development project management tool.
Your role is to analyze user requests and generate well-structured tasks with clear titles and descriptions.

Guidelines for task generation:
1. Create concise, actionable task titles that start with a verb (e.g., "Implement", "Fix", "Add", "Update", "Refactor")
2. Include relevant technical details in the description
3. Break down complex requests into multiple smaller, manageable tasks when appropriate
4. Consider the existing project context and avoid duplicating existing tasks
5. Set appropriate status (usually "todo" for new tasks)

Output format: Return a JSON object with a "tasks" array containing task objects.
Each task should have: title (string), description (string or null), status (string).
Optionally include "reasoning" to explain your task breakdown decisions.`;

/**
 * Builds the user prompt section with context and user input.
 */
function buildUserPrompt(options: TaskGenerationPromptOptions): string {
  const { userInput, context, maxTasks = 5 } = options;

  const contextSection = buildContextSection(context);

  return `${contextSection}

User Request:
${userInput}

Please generate up to ${maxTasks} well-structured tasks based on this request.
Return your response as a valid JSON object with the following structure:
{
  "tasks": [
    {
      "title": "Task title here",
      "description": "Detailed description or null",
      "status": "todo"
    }
  ],
  "reasoning": "Optional explanation of how you broke down the request"
}`;
}

/**
 * Builds the context section of the prompt with project information.
 */
function buildContextSection(context: ProjectContext): string {
  const parts: string[] = [];

  parts.push(`Project: ${context.projectName} (ID: ${context.projectId})`);

  if (context.repositories.length > 0) {
    const repoList = context.repositories
      .map((r) => `  - ${r.name}: ${r.path}`)
      .join('\n');
    parts.push(`\nRepositories:\n${repoList}`);
  }

  if (context.existingTasks && context.existingTasks.length > 0) {
    const taskList = context.existingTasks
      .slice(0, 10) // Limit to recent 10 tasks to keep prompt size reasonable
      .map((t) => `  - [${t.status}] ${t.title}`)
      .join('\n');
    parts.push(`\nExisting Tasks (recent):\n${taskList}`);
  }

  if (context.tags && context.tags.length > 0) {
    const tagList = context.tags.map((t) => `  - @${t.name}`).join('\n');
    parts.push(`\nAvailable Tags:\n${tagList}`);
  }

  return `Project Context:\n${parts.join('\n')}`;
}

/**
 * Builds the complete prompt for task generation.
 */
export function buildTaskGenerationPrompt(
  options: TaskGenerationPromptOptions
): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(options),
  };
}

/**
 * Parses the Claude response into structured task data.
 * Handles potential JSON parsing errors gracefully.
 */
export function parseTaskGenerationResponse(
  response: string
): TaskGenerationResponse {
  // Try to extract JSON from the response
  // Claude sometimes wraps JSON in markdown code blocks
  let jsonStr = response;

  // Remove markdown code block if present
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate the response structure
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error('Response missing required "tasks" array');
    }

    // Validate and sanitize each task
    const tasks: GeneratedTask[] = parsed.tasks.map(
      (task: Record<string, unknown>) => {
        if (!task.title || typeof task.title !== 'string') {
          throw new Error('Task missing required "title" field');
        }

        return {
          title: task.title.slice(0, 500), // Limit title length
          description:
            typeof task.description === 'string'
              ? task.description.slice(0, 5000) // Limit description length
              : null,
          status: validateStatus(task.status as string),
          suggestedTags: Array.isArray(task.suggestedTags)
            ? task.suggestedTags.filter(
                (t): t is string => typeof t === 'string'
              )
            : undefined,
        };
      }
    );

    return {
      tasks,
      reasoning:
        typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown parsing error';
    throw new Error(`Failed to parse task generation response: ${message}`);
  }
}

/**
 * Validates and normalizes task status.
 */
function validateStatus(
  status: string | undefined
): GeneratedTask['status'] {
  const validStatuses = [
    'todo',
    'inprogress',
    'inreview',
    'done',
    'cancelled',
  ] as const;
  if (status && validStatuses.includes(status as (typeof validStatuses)[number])) {
    return status as GeneratedTask['status'];
  }
  return 'todo'; // Default to todo for new tasks
}
