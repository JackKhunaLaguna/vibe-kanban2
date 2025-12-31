import { tasksApi } from '@/lib/api';
import type { Task, CreateTask } from 'shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a single task in a feature breakdown
 */
export interface FeatureTaskItem {
  /** Unique identifier within the breakdown (e.g., "task-1", "task-2") */
  id: string;
  /** Task title */
  title: string;
  /** Claude Code prompt for this task */
  prompt: string;
  /** Array of task IDs this task depends on (within this breakdown) */
  dependencies: string[];
  /** Execution tier number (tasks in lower tiers run before higher tiers) */
  tier: number;
  /** Task complexity estimate */
  complexity: 'low' | 'medium' | 'high';
  /** Estimated time in minutes */
  estimatedTime: number;
}

/**
 * Complete feature breakdown containing all tasks
 */
export interface FeatureBreakdown {
  /** Human-readable feature name */
  featureName: string;
  /** Project ID where tasks will be created */
  projectId: string;
  /** Array of tasks to create */
  tasks: FeatureTaskItem[];
}

/**
 * Metadata stored in task description for tracking dependencies and feature info
 */
export interface TaskMetadata {
  /** Feature ID that groups all tasks from the same breakdown */
  featureId: string;
  /** Claude Code prompt for the task */
  prompt: string;
  /** Array of real Vibe Kanban task IDs this depends on */
  dependencies: string[];
  /** Execution tier number */
  tier: number;
  /** Task complexity */
  complexity: 'low' | 'medium' | 'high';
  /** Estimated time in minutes */
  estimatedTime: number;
  /** Original task ID from the breakdown */
  originalId: string;
}

/**
 * Information about a failed task creation attempt
 */
export interface TaskCreationFailure {
  /** Original task ID from the breakdown */
  taskId: string;
  /** Task title */
  title: string;
  /** Error message describing the failure */
  error: string;
}

/**
 * Result returned from bulk task creation
 */
export interface CreateTasksResult {
  /** Total number of tasks in the breakdown */
  totalTasks: number;
  /** Number of tasks created successfully */
  createdSuccessfully: number;
  /** Array of failed task creations */
  failed: TaskCreationFailure[];
  /** Array of Vibe Kanban task IDs for successfully created tasks */
  createdTaskIds: string[];
  /** Unique identifier for this feature (used to group tasks) */
  featureId: string;
}

/**
 * Progress callback for UI updates during bulk creation
 */
export interface ProgressCallback {
  /** Called when a task creation starts */
  onTaskStart?: (taskId: string, title: string, index: number, total: number) => void;
  /** Called when a task is created successfully */
  onTaskSuccess?: (taskId: string, vibeKanbanId: string, index: number, total: number) => void;
  /** Called when a task creation fails */
  onTaskError?: (taskId: string, error: string, index: number, total: number) => void;
  /** Called when all tasks are processed */
  onComplete?: (result: CreateTasksResult) => void;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generates a unique feature ID using timestamp and random string
 */
export function generateFeatureId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `feature-${timestamp}-${randomPart}`;
}

/**
 * Encodes task metadata into a JSON string for storage in task description
 */
export function encodeTaskMetadata(metadata: TaskMetadata): string {
  return `<!-- FEATURE_METADATA\n${JSON.stringify(metadata, null, 2)}\n-->`;
}

/**
 * Decodes task metadata from a task description
 * Returns null if no metadata is found
 */
export function decodeTaskMetadata(description: string | null): TaskMetadata | null {
  if (!description) return null;

  const match = description.match(/<!-- FEATURE_METADATA\n([\s\S]*?)\n-->/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]) as TaskMetadata;
  } catch {
    return null;
  }
}

/**
 * Builds a description string containing the prompt and embedded metadata
 */
function buildTaskDescription(prompt: string, metadata: TaskMetadata): string {
  return `${prompt}\n\n${encodeTaskMetadata(metadata)}`;
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Creates multiple tasks at once with dependency metadata.
 *
 * Tasks are created in order (task-1, task-2, task-3...) and their IDs are
 * updated to real Vibe Kanban task IDs. If a task fails to create, the service
 * continues with remaining tasks and reports failures.
 *
 * @param breakdown - The feature breakdown containing tasks to create
 * @param progress - Optional progress callbacks for UI updates
 * @returns Result containing success/failure information and created task IDs
 *
 * @example
 * ```ts
 * const breakdown: FeatureBreakdown = {
 *   featureName: 'User Authentication',
 *   projectId: 'proj-123',
 *   tasks: [
 *     { id: 'task-1', title: 'Setup auth module', prompt: '...', dependencies: [], tier: 1, complexity: 'medium', estimatedTime: 30 },
 *     { id: 'task-2', title: 'Add login form', prompt: '...', dependencies: ['task-1'], tier: 2, complexity: 'low', estimatedTime: 20 },
 *   ]
 * };
 *
 * const result = await createFeatureTasks(breakdown, {
 *   onTaskSuccess: (taskId, vibeId) => console.log(`Created ${taskId} -> ${vibeId}`),
 * });
 * ```
 */
export async function createFeatureTasks(
  breakdown: FeatureBreakdown,
  progress?: ProgressCallback
): Promise<CreateTasksResult> {
  const featureId = generateFeatureId();
  const totalTasks = breakdown.tasks.length;

  // Maps original task IDs (e.g., "task-1") to real Vibe Kanban IDs
  const idMapping = new Map<string, string>();

  const createdTaskIds: string[] = [];
  const failed: TaskCreationFailure[] = [];

  // Process tasks in order
  for (let i = 0; i < breakdown.tasks.length; i++) {
    const taskItem = breakdown.tasks[i];

    // Notify UI that we're starting this task
    progress?.onTaskStart?.(taskItem.id, taskItem.title, i + 1, totalTasks);

    try {
      // Resolve dependencies to real Vibe Kanban IDs
      const resolvedDependencies: string[] = taskItem.dependencies
        .map(depId => idMapping.get(depId))
        .filter((id): id is string => id !== undefined);

      // Build metadata for this task
      const metadata: TaskMetadata = {
        featureId,
        prompt: taskItem.prompt,
        dependencies: resolvedDependencies,
        tier: taskItem.tier,
        complexity: taskItem.complexity,
        estimatedTime: taskItem.estimatedTime,
        originalId: taskItem.id,
      };

      // Build the full description with embedded metadata
      const description = buildTaskDescription(taskItem.prompt, metadata);

      // Create the task using the existing API
      const createData: CreateTask = {
        project_id: breakdown.projectId,
        title: taskItem.title,
        description,
        status: 'todo',
        parent_workspace_id: null,
        image_ids: null,
        shared_task_id: null,
      };

      const createdTask: Task = await tasksApi.create(createData);

      // Map original ID to real Vibe Kanban ID
      idMapping.set(taskItem.id, createdTask.id);
      createdTaskIds.push(createdTask.id);

      // Notify UI of success
      progress?.onTaskSuccess?.(taskItem.id, createdTask.id, i + 1, totalTasks);

    } catch (error) {
      // Handle failure - continue with remaining tasks
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      failed.push({
        taskId: taskItem.id,
        title: taskItem.title,
        error: errorMessage,
      });

      // Notify UI of error
      progress?.onTaskError?.(taskItem.id, errorMessage, i + 1, totalTasks);
    }
  }

  const result: CreateTasksResult = {
    totalTasks,
    createdSuccessfully: createdTaskIds.length,
    failed,
    createdTaskIds,
    featureId,
  };

  // Notify UI of completion
  progress?.onComplete?.(result);

  return result;
}

// ============================================================================
// Helper Functions for Working with Created Tasks
// ============================================================================

/**
 * Gets all tasks belonging to a specific feature by featureId.
 * This iterates through all project tasks and filters by metadata.
 *
 * @param tasks - Array of tasks to search through
 * @param featureId - The feature ID to filter by
 * @returns Array of tasks belonging to the feature
 */
export function getTasksByFeatureId(tasks: Task[], featureId: string): Task[] {
  return tasks.filter(task => {
    const metadata = decodeTaskMetadata(task.description);
    return metadata?.featureId === featureId;
  });
}

/**
 * Gets the dependency graph for a feature's tasks.
 * Returns a map where keys are task IDs and values are arrays of dependent task IDs.
 *
 * @param tasks - Array of tasks from the same feature
 * @returns Map of task ID to array of task IDs that depend on it
 */
export function getFeatureDependencyGraph(tasks: Task[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  // Initialize all tasks with empty dependency arrays
  for (const task of tasks) {
    graph.set(task.id, []);
  }

  // Build reverse dependency graph (who depends on whom)
  for (const task of tasks) {
    const metadata = decodeTaskMetadata(task.description);
    if (metadata?.dependencies) {
      for (const depId of metadata.dependencies) {
        const dependents = graph.get(depId);
        if (dependents) {
          dependents.push(task.id);
        }
      }
    }
  }

  return graph;
}

/**
 * Gets tasks organized by tier for a feature.
 *
 * @param tasks - Array of tasks from the same feature
 * @returns Map of tier number to array of tasks in that tier
 */
export function getTasksByTier(tasks: Task[]): Map<number, Task[]> {
  const tierMap = new Map<number, Task[]>();

  for (const task of tasks) {
    const metadata = decodeTaskMetadata(task.description);
    const tier = metadata?.tier ?? 0;

    if (!tierMap.has(tier)) {
      tierMap.set(tier, []);
    }
    tierMap.get(tier)!.push(task);
  }

  return tierMap;
}
