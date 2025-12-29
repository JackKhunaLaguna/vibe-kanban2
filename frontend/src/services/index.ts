/**
 * Services barrel export
 */

// Task Generation
export {
  generateTasks,
  generateTasksWithContext,
  type TaskGenerationRequest,
  type TaskGenerationResult,
  type TaskGenerationError,
  type TaskGenerationOutcome,
  type GeneratedTask,
  type ProjectContext,
} from './claudeTaskGenerator';

export {
  getProjectContext,
  createMinimalContext,
  validateProjectContext,
  type ProjectContextProviderOptions,
} from './projectContextProvider';

export {
  buildTaskGenerationPrompt,
  parseTaskGenerationResponse,
  type TaskGenerationPromptOptions,
  type TaskGenerationResponse,
} from './taskGenerationPrompt';
