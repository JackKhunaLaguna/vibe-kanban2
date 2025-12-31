/**
 * Dependency Analyzer Service
 *
 * Validates task dependencies and ensures they form a valid directed acyclic graph (DAG).
 * Calculates execution tiers for parallel task execution.
 */

/**
 * Represents a task with its dependencies
 */
export interface TaskBreakdown {
  id: string;
  title: string;
  description?: string;
  dependencies: string[];
}

/**
 * Result of dependency validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Execution plan grouped by tiers
 */
export interface ExecutionPlan {
  tiers: string[][];
  tierCount: number;
}

/**
 * Validates task dependencies for a collection of tasks.
 *
 * Checks for:
 * - Circular dependencies
 * - References to non-existent tasks
 * - Self-references
 *
 * @param tasks - Array of tasks with their dependencies
 * @returns ValidationResult with isValid flag, errors, and warnings
 */
export function validateDependencies(tasks: TaskBreakdown[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const taskIds = new Set(tasks.map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Check for duplicate task IDs
  if (taskIds.size !== tasks.length) {
    const seen = new Set<string>();
    for (const task of tasks) {
      if (seen.has(task.id)) {
        errors.push(`Duplicate task ID: "${task.id}"`);
      }
      seen.add(task.id);
    }
  }

  // Check each task's dependencies
  for (const task of tasks) {
    // Check for self-reference
    if (task.dependencies.includes(task.id)) {
      errors.push(`Task "${task.id}" depends on itself`);
    }

    // Check for non-existent dependencies
    for (const depId of task.dependencies) {
      if (!taskIds.has(depId)) {
        errors.push(
          `Task "${task.id}" depends on non-existent task "${depId}"`
        );
      }
    }

    // Check for duplicate dependencies (warning)
    const uniqueDeps = new Set(task.dependencies);
    if (uniqueDeps.size !== task.dependencies.length) {
      warnings.push(`Task "${task.id}" has duplicate dependencies`);
    }
  }

  // Check for circular dependencies using DFS
  const circularPaths = detectCircularDependencies(taskMap);
  for (const path of circularPaths) {
    errors.push(`Circular dependency detected: ${path.join(' -> ')}`);
  }

  // Add warning for tasks with no dependencies that might be entry points
  const tasksWithNoDeps = tasks.filter((t) => t.dependencies.length === 0);
  if (tasksWithNoDeps.length === 0 && tasks.length > 0) {
    warnings.push(
      'No tasks without dependencies found - verify this is intentional'
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detects circular dependencies in the task graph using DFS.
 *
 * @param taskMap - Map of task IDs to tasks
 * @returns Array of circular dependency paths
 */
function detectCircularDependencies(
  taskMap: Map<string, TaskBreakdown>
): string[][] {
  const circularPaths: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(taskId: string): boolean {
    if (recursionStack.has(taskId)) {
      // Found a cycle - extract the cycle path
      const cycleStartIndex = path.indexOf(taskId);
      const cyclePath = [...path.slice(cycleStartIndex), taskId];
      circularPaths.push(cyclePath);
      return true;
    }

    if (visited.has(taskId)) {
      return false;
    }

    const task = taskMap.get(taskId);
    if (!task) {
      return false;
    }

    visited.add(taskId);
    recursionStack.add(taskId);
    path.push(taskId);

    for (const depId of task.dependencies) {
      if (taskMap.has(depId)) {
        dfs(depId);
      }
    }

    path.pop();
    recursionStack.delete(taskId);
    return false;
  }

  for (const taskId of taskMap.keys()) {
    if (!visited.has(taskId)) {
      dfs(taskId);
    }
  }

  // Remove duplicate cycle reports (same cycle starting from different nodes)
  const uniqueCycles = deduplicateCycles(circularPaths);
  return uniqueCycles;
}

/**
 * Removes duplicate cycle reports that represent the same cycle.
 */
function deduplicateCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  const unique: string[][] = [];

  for (const cycle of cycles) {
    // Normalize the cycle by finding the smallest ID and rotating
    const normalized = normalizeCycle(cycle);
    const key = normalized.join('->');

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

/**
 * Normalizes a cycle by rotating it to start with the smallest element.
 */
function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length <= 1) return cycle;

  // Remove the duplicate end element for comparison
  const cycleWithoutEnd = cycle.slice(0, -1);

  // Find the index of the smallest element
  let minIndex = 0;
  for (let i = 1; i < cycleWithoutEnd.length; i++) {
    if (cycleWithoutEnd[i] < cycleWithoutEnd[minIndex]) {
      minIndex = i;
    }
  }

  // Rotate the cycle
  const rotated = [
    ...cycleWithoutEnd.slice(minIndex),
    ...cycleWithoutEnd.slice(0, minIndex),
  ];
  return [...rotated, rotated[0]];
}

/**
 * Calculates execution tier for each task.
 *
 * - Tier 1: Tasks with no dependencies
 * - Tier N: Tasks whose max dependency tier is N-1
 *
 * @param tasks - Array of tasks with their dependencies
 * @returns Map of taskId to tier number (1-indexed)
 */
export function calculateTiers(tasks: TaskBreakdown[]): Map<string, number> {
  const tierMap = new Map<string, number>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const taskIds = new Set(tasks.map((t) => t.id));

  // Validate first - return empty map if invalid
  const validation = validateDependencies(tasks);
  if (!validation.isValid) {
    return tierMap;
  }

  /**
   * Recursively calculates tier for a task using memoization.
   */
  function getTier(taskId: string): number {
    // Return cached result
    if (tierMap.has(taskId)) {
      return tierMap.get(taskId)!;
    }

    const task = taskMap.get(taskId);
    if (!task) {
      return 0;
    }

    // Tasks with no dependencies are tier 1
    if (task.dependencies.length === 0) {
      tierMap.set(taskId, 1);
      return 1;
    }

    // Filter to only valid dependencies
    const validDeps = task.dependencies.filter((d) => taskIds.has(d));

    if (validDeps.length === 0) {
      tierMap.set(taskId, 1);
      return 1;
    }

    // Tier = max(dependency tiers) + 1
    const maxDepTier = Math.max(...validDeps.map((depId) => getTier(depId)));
    const tier = maxDepTier + 1;
    tierMap.set(taskId, tier);
    return tier;
  }

  // Calculate tier for each task
  for (const task of tasks) {
    getTier(task.id);
  }

  return tierMap;
}

/**
 * Creates an execution plan by grouping tasks by their execution tier.
 *
 * Tasks in the same tier can run in parallel as they have no
 * inter-dependencies at that level.
 *
 * @param tasks - Array of tasks with their dependencies
 * @returns ExecutionPlan with tasks grouped by tier
 */
export function getExecutionPlan(tasks: TaskBreakdown[]): ExecutionPlan {
  // Validate first
  const validation = validateDependencies(tasks);
  if (!validation.isValid) {
    return {
      tiers: [],
      tierCount: 0,
    };
  }

  const tierMap = calculateTiers(tasks);

  if (tierMap.size === 0) {
    return {
      tiers: [],
      tierCount: 0,
    };
  }

  // Group tasks by tier
  const tierGroups = new Map<number, string[]>();

  for (const [taskId, tier] of tierMap) {
    if (!tierGroups.has(tier)) {
      tierGroups.set(tier, []);
    }
    tierGroups.get(tier)!.push(taskId);
  }

  // Find max tier
  const maxTier = Math.max(...tierGroups.keys());

  // Build tiers array (1-indexed in the map, 0-indexed in array)
  const tiers: string[][] = [];
  for (let i = 1; i <= maxTier; i++) {
    tiers.push(tierGroups.get(i) || []);
  }

  return {
    tiers,
    tierCount: maxTier,
  };
}

/**
 * Gets the critical path - the longest dependency chain in the task graph.
 *
 * @param tasks - Array of tasks with their dependencies
 * @returns Array of task IDs representing the critical path
 */
export function getCriticalPath(tasks: TaskBreakdown[]): string[] {
  const validation = validateDependencies(tasks);
  if (!validation.isValid) {
    return [];
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, string[]>();

  function getLongestPath(taskId: string): string[] {
    if (memo.has(taskId)) {
      return memo.get(taskId)!;
    }

    const task = taskMap.get(taskId);
    if (!task) {
      return [];
    }

    if (task.dependencies.length === 0) {
      const path = [taskId];
      memo.set(taskId, path);
      return path;
    }

    let longestDepPath: string[] = [];
    for (const depId of task.dependencies) {
      if (taskMap.has(depId)) {
        const depPath = getLongestPath(depId);
        if (depPath.length > longestDepPath.length) {
          longestDepPath = depPath;
        }
      }
    }

    const path = [...longestDepPath, taskId];
    memo.set(taskId, path);
    return path;
  }

  // Find the longest path across all tasks
  let criticalPath: string[] = [];
  for (const task of tasks) {
    const path = getLongestPath(task.id);
    if (path.length > criticalPath.length) {
      criticalPath = path;
    }
  }

  return criticalPath;
}

/**
 * Gets all tasks that depend on a given task (directly or indirectly).
 *
 * @param tasks - Array of tasks with their dependencies
 * @param taskId - The task ID to find dependents for
 * @returns Set of task IDs that depend on the given task
 */
export function getDependents(
  tasks: TaskBreakdown[],
  taskId: string
): Set<string> {
  const dependents = new Set<string>();

  // Build reverse dependency map
  const reverseDeps = new Map<string, Set<string>>();
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (!reverseDeps.has(depId)) {
        reverseDeps.set(depId, new Set());
      }
      reverseDeps.get(depId)!.add(task.id);
    }
  }

  // BFS to find all dependents
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const directDependents = reverseDeps.get(current);
    if (directDependents) {
      for (const dependent of directDependents) {
        if (!dependents.has(dependent)) {
          dependents.add(dependent);
          queue.push(dependent);
        }
      }
    }
  }

  return dependents;
}

/**
 * Gets all dependencies of a given task (directly or indirectly).
 *
 * @param tasks - Array of tasks with their dependencies
 * @param taskId - The task ID to find dependencies for
 * @returns Set of task IDs that the given task depends on
 */
export function getAllDependencies(
  tasks: TaskBreakdown[],
  taskId: string
): Set<string> {
  const allDeps = new Set<string>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  function collect(id: string) {
    const task = taskMap.get(id);
    if (!task) return;

    for (const depId of task.dependencies) {
      if (!allDeps.has(depId) && taskMap.has(depId)) {
        allDeps.add(depId);
        collect(depId);
      }
    }
  }

  collect(taskId);
  return allDeps;
}
