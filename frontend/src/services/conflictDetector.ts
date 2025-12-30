import type { Diff, DiffChangeKind } from 'shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a range of lines in a file
 */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * Represents a file change from a task's diff
 */
export interface FileChange {
  path: string;
  changeKind: DiffChangeKind;
  lineRanges: LineRange[];
  imports?: string[];
  exports?: string[];
  content?: string;
}

/**
 * Represents a task with its associated diffs
 */
export interface TaskDiff {
  taskId: string;
  taskTitle?: string;
  diffs: Diff[];
}

/**
 * Conflict types that can be detected
 */
export type ConflictType = 'file' | 'logic' | 'dependency';

/**
 * Severity levels for conflicts
 */
export type ConflictSeverity = 'critical' | 'major' | 'minor';

/**
 * Represents a detected conflict between tasks
 */
export interface Conflict {
  type: ConflictType;
  severity: ConflictSeverity;
  affectedTasks: string[];
  affectedFiles: string[];
  description: string;
  suggestedResolution?: string;
}

/**
 * Result of conflict detection
 */
export interface ConflictDetectionResult {
  conflicts: Conflict[];
  analyzedTasks: number;
  analyzedFiles: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extracts line ranges from a unified diff string
 */
function extractLineRangesFromDiff(diffContent: string | null): LineRange[] {
  if (!diffContent) return [];

  const ranges: LineRange[] = [];
  // Match unified diff hunk headers: @@ -start,count +start,count @@
  const hunkPattern = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;

  let match;
  while ((match = hunkPattern.exec(diffContent)) !== null) {
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] ? parseInt(match[4], 10) : 1;
    ranges.push({
      start: newStart,
      end: newStart + newCount - 1,
    });
  }

  return ranges;
}

/**
 * Extracts import statements from file content
 */
function extractImports(content: string | null): string[] {
  if (!content) return [];

  const imports: string[] = [];

  // ES6 imports: import X from 'Y' or import { X } from 'Y'
  const es6ImportPattern =
    /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]+\})|(?:\w+))?\s*(?:,\s*(?:\{[^}]+\}|\w+))?\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = es6ImportPattern.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // CommonJS requires: require('X') or require("X")
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return [...new Set(imports)];
}

/**
 * Extracts export statements from file content
 */
function extractExports(content: string | null): string[] {
  if (!content) return [];

  const exports: string[] = [];

  // Named exports: export { X, Y }
  const namedExportPattern = /export\s*\{([^}]+)\}/g;
  let match;
  while ((match = namedExportPattern.exec(content)) !== null) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
    exports.push(...names);
  }

  // Direct exports: export const/let/var/function/class X
  const directExportPattern =
    /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  while ((match = directExportPattern.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Default export
  if (/export\s+default/.test(content)) {
    exports.push('default');
  }

  return [...new Set(exports)];
}

/**
 * Gets the effective file path from a diff (handles renames)
 */
function getEffectiveFilePath(diff: Diff): string | null {
  return diff.newPath || diff.oldPath;
}

/**
 * Checks if two line ranges overlap
 */
function rangesOverlap(range1: LineRange, range2: LineRange): boolean {
  return range1.start <= range2.end && range2.start <= range1.end;
}

/**
 * Checks if any ranges from two arrays overlap
 */
function anyRangesOverlap(ranges1: LineRange[], ranges2: LineRange[]): boolean {
  for (const r1 of ranges1) {
    for (const r2 of ranges2) {
      if (rangesOverlap(r1, r2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Converts a Diff to a FileChange for analysis
 */
function diffToFileChange(diff: Diff): FileChange | null {
  const path = getEffectiveFilePath(diff);
  if (!path) return null;

  const content = diff.newContent || diff.oldContent;
  const lineRanges = extractLineRangesFromDiff(content);

  return {
    path,
    changeKind: diff.change,
    lineRanges,
    imports: extractImports(content),
    exports: extractExports(content),
    content: content || undefined,
  };
}

// ============================================================================
// File-Level Conflict Detection
// ============================================================================

/**
 * Detects conflicts where multiple tasks modify the same file
 */
function detectSameFileConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const fileToTasks = new Map<string, string[]>();

  // Build a map of files to tasks that modify them
  for (const [taskId, fileChanges] of taskChanges) {
    for (const [filePath] of fileChanges) {
      const tasks = fileToTasks.get(filePath) || [];
      tasks.push(taskId);
      fileToTasks.set(filePath, tasks);
    }
  }

  // Find files modified by multiple tasks
  for (const [filePath, taskIds] of fileToTasks) {
    if (taskIds.length > 1) {
      conflicts.push({
        type: 'file',
        severity: 'major',
        affectedTasks: taskIds,
        affectedFiles: [filePath],
        description: `Multiple tasks (${taskIds.join(', ')}) modify the same file: ${filePath}`,
        suggestedResolution:
          'Review changes to ensure they are compatible, or merge tasks sequentially',
      });
    }
  }

  return conflicts;
}

/**
 * Detects conflicts where tasks have overlapping line changes
 */
function detectOverlappingLineConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const fileToTaskChanges = new Map<string, Array<{ taskId: string; change: FileChange }>>();

  // Group changes by file
  for (const [taskId, fileChanges] of taskChanges) {
    for (const [filePath, change] of fileChanges) {
      const changes = fileToTaskChanges.get(filePath) || [];
      changes.push({ taskId, change });
      fileToTaskChanges.set(filePath, changes);
    }
  }

  // Check for overlapping line ranges
  for (const [filePath, changes] of fileToTaskChanges) {
    for (let i = 0; i < changes.length; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        const change1 = changes[i];
        const change2 = changes[j];

        if (
          change1.change.lineRanges.length > 0 &&
          change2.change.lineRanges.length > 0 &&
          anyRangesOverlap(change1.change.lineRanges, change2.change.lineRanges)
        ) {
          conflicts.push({
            type: 'file',
            severity: 'critical',
            affectedTasks: [change1.taskId, change2.taskId],
            affectedFiles: [filePath],
            description: `Tasks ${change1.taskId} and ${change2.taskId} have overlapping line changes in ${filePath}`,
            suggestedResolution:
              'These tasks modify the same lines and will likely cause merge conflicts. Consider executing them sequentially.',
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects import/export conflicts between tasks
 */
function detectImportExportConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Track all exports per file per task
  const taskExports = new Map<string, Map<string, Set<string>>>();
  // Track all imports per task
  const taskImports = new Map<string, Set<string>>();

  for (const [taskId, fileChanges] of taskChanges) {
    const exportsMap = new Map<string, Set<string>>();
    const importsSet = new Set<string>();

    for (const [filePath, change] of fileChanges) {
      if (change.exports && change.exports.length > 0) {
        exportsMap.set(filePath, new Set(change.exports));
      }
      if (change.imports) {
        change.imports.forEach((imp) => importsSet.add(imp));
      }
    }

    taskExports.set(taskId, exportsMap);
    taskImports.set(taskId, importsSet);
  }

  // Detect conflicting exports (same export name removed/changed in different files)
  const taskIds = Array.from(taskChanges.keys());
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const task1 = taskIds[i];
      const task2 = taskIds[j];
      const exports1 = taskExports.get(task1);
      const exports2 = taskExports.get(task2);

      if (exports1 && exports2) {
        // Check if tasks export conflicting symbols from same file
        for (const [file1, exports1Set] of exports1) {
          const exports2Set = exports2.get(file1);
          if (exports2Set) {
            const commonExports = [...exports1Set].filter((e) => exports2Set.has(e));
            if (commonExports.length > 0) {
              conflicts.push({
                type: 'file',
                severity: 'major',
                affectedTasks: [task1, task2],
                affectedFiles: [file1],
                description: `Tasks ${task1} and ${task2} both modify exports (${commonExports.join(', ')}) in ${file1}`,
                suggestedResolution:
                  'Ensure export changes are compatible or coordinate between tasks',
              });
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects all file-level conflicts
 */
function detectFileLevelConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  return [
    ...detectSameFileConflicts(taskChanges),
    ...detectOverlappingLineConflicts(taskChanges),
    ...detectImportExportConflicts(taskChanges),
  ];
}

// ============================================================================
// Logic Conflict Detection
// ============================================================================

/**
 * Pattern definitions for detecting specific types of code changes
 */
const PATTERNS = {
  apiEndpoint: /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  functionSignature: /(?:function|const|let|var)\s+(\w+)\s*(?:=\s*)?\([^)]*\)/g,
  interfaceDefinition: /interface\s+(\w+)\s*\{/g,
  typeDefinition: /type\s+(\w+)\s*=/g,
  classDefinition: /class\s+(\w+)/g,
  schemaDefinition: /(?:create_table|CREATE\s+TABLE|schema\s*\.\s*createTable)\s*\(?['"`]?(\w+)['"`]?/gi,
  migrationFile: /migrations?\/.*\.(sql|ts|js)$/i,
};

/**
 * Extracts API endpoints from content
 */
function extractApiEndpoints(content: string | null): Array<{ method: string; path: string }> {
  if (!content) return [];

  const endpoints: Array<{ method: string; path: string }> = [];
  const pattern = new RegExp(PATTERNS.apiEndpoint.source, 'gi');

  let match;
  while ((match = pattern.exec(content)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: match[2],
    });
  }

  return endpoints;
}

/**
 * Extracts function signatures from content
 */
function extractFunctionSignatures(content: string | null): string[] {
  if (!content) return [];

  const functions: string[] = [];
  const pattern = new RegExp(PATTERNS.functionSignature.source, 'g');

  let match;
  while ((match = pattern.exec(content)) !== null) {
    functions.push(match[1]);
  }

  return [...new Set(functions)];
}

/**
 * Extracts type/interface definitions from content
 */
function extractTypeDefinitions(content: string | null): string[] {
  if (!content) return [];

  const types: string[] = [];

  const interfacePattern = new RegExp(PATTERNS.interfaceDefinition.source, 'g');
  let match;
  while ((match = interfacePattern.exec(content)) !== null) {
    types.push(match[1]);
  }

  const typePattern = new RegExp(PATTERNS.typeDefinition.source, 'g');
  while ((match = typePattern.exec(content)) !== null) {
    types.push(match[1]);
  }

  return [...new Set(types)];
}

/**
 * Extracts database schema/table definitions from content
 */
function extractSchemaDefinitions(content: string | null): string[] {
  if (!content) return [];

  const schemas: string[] = [];
  const pattern = new RegExp(PATTERNS.schemaDefinition.source, 'gi');

  let match;
  while ((match = pattern.exec(content)) !== null) {
    schemas.push(match[1].toLowerCase());
  }

  return [...new Set(schemas)];
}

/**
 * Detects API conflicts (incompatible endpoint changes)
 */
function detectApiConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const taskEndpoints = new Map<string, Array<{ method: string; path: string; file: string }>>();

  // Extract endpoints per task
  for (const [taskId, fileChanges] of taskChanges) {
    const endpoints: Array<{ method: string; path: string; file: string }> = [];

    for (const [filePath, change] of fileChanges) {
      const fileEndpoints = extractApiEndpoints(change.content || null);
      endpoints.push(...fileEndpoints.map((e) => ({ ...e, file: filePath })));
    }

    if (endpoints.length > 0) {
      taskEndpoints.set(taskId, endpoints);
    }
  }

  // Compare endpoints between tasks
  const taskIds = Array.from(taskEndpoints.keys());
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const task1 = taskIds[i];
      const task2 = taskIds[j];
      const endpoints1 = taskEndpoints.get(task1) || [];
      const endpoints2 = taskEndpoints.get(task2) || [];

      // Find conflicting endpoints (same method + path in different tasks)
      for (const e1 of endpoints1) {
        for (const e2 of endpoints2) {
          if (e1.method === e2.method && e1.path === e2.path) {
            conflicts.push({
              type: 'logic',
              severity: 'critical',
              affectedTasks: [task1, task2],
              affectedFiles: [e1.file, e2.file].filter((f, i, arr) => arr.indexOf(f) === i),
              description: `Tasks ${task1} and ${task2} both modify API endpoint ${e1.method} ${e1.path}`,
              suggestedResolution:
                'Coordinate API changes to avoid conflicting implementations',
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects type/interface definition conflicts
 */
function detectTypeConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const taskTypes = new Map<string, Map<string, string[]>>();

  // Extract types per task
  for (const [taskId, fileChanges] of taskChanges) {
    const typesMap = new Map<string, string[]>();

    for (const [filePath, change] of fileChanges) {
      const types = extractTypeDefinitions(change.content || null);
      if (types.length > 0) {
        typesMap.set(filePath, types);
      }
    }

    if (typesMap.size > 0) {
      taskTypes.set(taskId, typesMap);
    }
  }

  // Compare types between tasks
  const taskIds = Array.from(taskTypes.keys());
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const task1 = taskIds[i];
      const task2 = taskIds[j];
      const types1 = taskTypes.get(task1);
      const types2 = taskTypes.get(task2);

      if (types1 && types2) {
        // Find types modified in both tasks
        for (const [file1, typeNames1] of types1) {
          for (const [file2, typeNames2] of types2) {
            const commonTypes = typeNames1.filter((t) => typeNames2.includes(t));
            if (commonTypes.length > 0) {
              conflicts.push({
                type: 'logic',
                severity: file1 === file2 ? 'critical' : 'major',
                affectedTasks: [task1, task2],
                affectedFiles: [file1, file2].filter((f, i, arr) => arr.indexOf(f) === i),
                description: `Tasks ${task1} and ${task2} both modify type definitions: ${commonTypes.join(', ')}`,
                suggestedResolution:
                  'Ensure type changes are compatible or coordinate modifications',
              });
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects database schema conflicts
 */
function detectSchemaConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];
  const taskSchemas = new Map<string, Map<string, string[]>>();

  // Extract schemas per task (focus on migration files)
  for (const [taskId, fileChanges] of taskChanges) {
    const schemasMap = new Map<string, string[]>();

    for (const [filePath, change] of fileChanges) {
      // Only analyze files that look like migrations or schema definitions
      if (
        PATTERNS.migrationFile.test(filePath) ||
        filePath.includes('schema') ||
        filePath.includes('model')
      ) {
        const schemas = extractSchemaDefinitions(change.content || null);
        if (schemas.length > 0) {
          schemasMap.set(filePath, schemas);
        }
      }
    }

    if (schemasMap.size > 0) {
      taskSchemas.set(taskId, schemasMap);
    }
  }

  // Compare schemas between tasks
  const taskIds = Array.from(taskSchemas.keys());
  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const task1 = taskIds[i];
      const task2 = taskIds[j];
      const schemas1 = taskSchemas.get(task1);
      const schemas2 = taskSchemas.get(task2);

      if (schemas1 && schemas2) {
        const allTables1 = new Set<string>();
        const allTables2 = new Set<string>();
        const files1: string[] = [];
        const files2: string[] = [];

        for (const [file, tables] of schemas1) {
          tables.forEach((t) => allTables1.add(t));
          files1.push(file);
        }
        for (const [file, tables] of schemas2) {
          tables.forEach((t) => allTables2.add(t));
          files2.push(file);
        }

        const commonTables = [...allTables1].filter((t) => allTables2.has(t));
        if (commonTables.length > 0) {
          conflicts.push({
            type: 'logic',
            severity: 'critical',
            affectedTasks: [task1, task2],
            affectedFiles: [...files1, ...files2].filter((f, i, arr) => arr.indexOf(f) === i),
            description: `Tasks ${task1} and ${task2} both modify database schema for tables: ${commonTables.join(', ')}`,
            suggestedResolution:
              'Database schema changes must be carefully coordinated. Consider creating separate migrations and reviewing execution order.',
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects all logic-level conflicts
 */
function detectLogicConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  return [
    ...detectApiConflicts(taskChanges),
    ...detectTypeConflicts(taskChanges),
    ...detectSchemaConflicts(taskChanges),
  ];
}

// ============================================================================
// Dependency Conflict Detection
// ============================================================================

/**
 * Builds a dependency graph from task changes
 */
function buildDependencyGraph(
  taskChanges: Map<string, Map<string, FileChange>>
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Track which task exports what and which task imports what
  const taskExportedFiles = new Map<string, Set<string>>();

  // First pass: identify what each task exports/creates
  for (const [taskId, fileChanges] of taskChanges) {
    const exportedFiles = new Set<string>();

    for (const [filePath, change] of fileChanges) {
      // If a task adds a new file or has exports, other tasks might depend on it
      if (change.changeKind === 'added' || (change.exports && change.exports.length > 0)) {
        exportedFiles.add(filePath);
      }
    }

    taskExportedFiles.set(taskId, exportedFiles);
    graph.set(taskId, new Set());
  }

  // Second pass: identify dependencies based on imports
  for (const [taskId, fileChanges] of taskChanges) {
    for (const [, change] of fileChanges) {
      if (change.imports) {
        // Check if any import matches files created/modified by other tasks
        for (const [otherTaskId, exportedFiles] of taskExportedFiles) {
          if (otherTaskId === taskId) continue;

          for (const importPath of change.imports) {
            // Check if the import might reference a file from another task
            for (const exportedFile of exportedFiles) {
              // Simple path matching (could be more sophisticated)
              if (
                exportedFile.includes(importPath) ||
                importPath.includes(exportedFile.replace(/\.(ts|js|tsx|jsx)$/, ''))
              ) {
                const deps = graph.get(taskId) || new Set();
                deps.add(otherTaskId);
                graph.set(taskId, deps);
              }
            }
          }
        }
      }
    }
  }

  return graph;
}

/**
 * Detects circular dependencies between tasks
 */
function detectCircularDependencies(dependencyGraph: Map<string, Set<string>>): Conflict[] {
  const conflicts: Conflict[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (recursionStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart));
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    recursionStack.add(node);

    const dependencies = dependencyGraph.get(node) || new Set();
    for (const dep of dependencies) {
      dfs(dep, [...path, node]);
    }

    recursionStack.delete(node);
  }

  for (const node of dependencyGraph.keys()) {
    dfs(node, []);
  }

  // Create conflicts for each cycle
  for (const cycle of cycles) {
    // Collect all files involved in the cycle
    const affectedFiles: string[] = [];

    conflicts.push({
      type: 'dependency',
      severity: 'critical',
      affectedTasks: cycle,
      affectedFiles,
      description: `Circular dependency detected: ${cycle.join(' → ')} → ${cycle[0]}`,
      suggestedResolution:
        'Break the circular dependency by restructuring the changes or executing tasks in a specific order',
    });
  }

  return conflicts;
}

/**
 * Detects missing dependencies between tasks
 */
function detectMissingDependencies(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Track files that are deleted by each task
  const deletedFiles = new Map<string, Set<string>>();

  for (const [taskId, fileChanges] of taskChanges) {
    const deleted = new Set<string>();
    for (const [filePath, change] of fileChanges) {
      if (change.changeKind === 'deleted') {
        deleted.add(filePath);
      }
    }
    if (deleted.size > 0) {
      deletedFiles.set(taskId, deleted);
    }
  }

  // Check if any task imports files that are deleted by another task
  for (const [taskId, fileChanges] of taskChanges) {
    for (const [filePath, change] of fileChanges) {
      if (change.imports) {
        for (const [otherTaskId, deleted] of deletedFiles) {
          if (otherTaskId === taskId) continue;

          for (const importPath of change.imports) {
            for (const deletedFile of deleted) {
              if (
                deletedFile.includes(importPath) ||
                importPath.includes(deletedFile.replace(/\.(ts|js|tsx|jsx)$/, ''))
              ) {
                conflicts.push({
                  type: 'dependency',
                  severity: 'critical',
                  affectedTasks: [taskId, otherTaskId],
                  affectedFiles: [filePath, deletedFile],
                  description: `Task ${taskId} imports a file (${deletedFile}) that task ${otherTaskId} deletes`,
                  suggestedResolution:
                    'Execute the importing task before the deleting task, or update imports',
                });
              }
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detects all dependency-level conflicts
 */
function detectDependencyConflicts(
  taskChanges: Map<string, Map<string, FileChange>>
): Conflict[] {
  const dependencyGraph = buildDependencyGraph(taskChanges);

  return [
    ...detectCircularDependencies(dependencyGraph),
    ...detectMissingDependencies(taskChanges),
  ];
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Preprocesses task diffs into a structured format for analysis
 */
function preprocessTaskDiffs(
  tasks: TaskDiff[]
): Map<string, Map<string, FileChange>> {
  const taskChanges = new Map<string, Map<string, FileChange>>();

  for (const task of tasks) {
    const fileChanges = new Map<string, FileChange>();

    for (const diff of task.diffs) {
      const change = diffToFileChange(diff);
      if (change) {
        fileChanges.set(change.path, change);
      }
    }

    if (fileChanges.size > 0) {
      taskChanges.set(task.taskId, fileChanges);
    }
  }

  return taskChanges;
}

/**
 * Validates input tasks
 */
function validateTasks(tasks: TaskDiff[]): void {
  if (!Array.isArray(tasks)) {
    throw new Error('Tasks must be an array');
  }

  for (const task of tasks) {
    if (!task.taskId || typeof task.taskId !== 'string') {
      throw new Error('Each task must have a valid taskId string');
    }
    if (!Array.isArray(task.diffs)) {
      throw new Error(`Task ${task.taskId} must have a diffs array`);
    }
  }
}

/**
 * Deduplicates conflicts based on affected tasks and files
 */
function deduplicateConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const deduplicated: Conflict[] = [];

  for (const conflict of conflicts) {
    const key = `${conflict.type}:${conflict.affectedTasks.sort().join(',')}:${conflict.affectedFiles.sort().join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(conflict);
    }
  }

  return deduplicated;
}

/**
 * Sorts conflicts by severity (critical first, then major, then minor)
 */
function sortConflictsBySeverity(conflicts: Conflict[]): Conflict[] {
  const severityOrder: Record<ConflictSeverity, number> = {
    critical: 0,
    major: 1,
    minor: 2,
  };

  return [...conflicts].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}

/**
 * Main function to detect conflicts between multiple task diffs
 *
 * @param tasks - Array of TaskDiff objects containing task IDs and their diffs
 * @returns ConflictDetectionResult containing all detected conflicts
 *
 * @example
 * const result = detectConflicts([
 *   { taskId: 'task-1', diffs: [...] },
 *   { taskId: 'task-2', diffs: [...] }
 * ]);
 * console.log(result.conflicts);
 */
export function detectConflicts(tasks: TaskDiff[]): ConflictDetectionResult {
  // Handle edge cases
  if (!tasks || tasks.length === 0) {
    return {
      conflicts: [],
      analyzedTasks: 0,
      analyzedFiles: 0,
    };
  }

  if (tasks.length === 1) {
    // Can't have conflicts with only one task
    const analyzedFiles = new Set<string>();
    for (const diff of tasks[0].diffs) {
      const path = getEffectiveFilePath(diff);
      if (path) analyzedFiles.add(path);
    }

    return {
      conflicts: [],
      analyzedTasks: 1,
      analyzedFiles: analyzedFiles.size,
    };
  }

  // Validate input
  validateTasks(tasks);

  // Preprocess diffs
  const taskChanges = preprocessTaskDiffs(tasks);

  // Collect all analyzed files
  const allFiles = new Set<string>();
  for (const [, fileChanges] of taskChanges) {
    for (const [filePath] of fileChanges) {
      allFiles.add(filePath);
    }
  }

  // Detect all types of conflicts
  const allConflicts: Conflict[] = [
    ...detectFileLevelConflicts(taskChanges),
    ...detectLogicConflicts(taskChanges),
    ...detectDependencyConflicts(taskChanges),
  ];

  // Deduplicate and sort
  const conflicts = sortConflictsBySeverity(deduplicateConflicts(allConflicts));

  return {
    conflicts,
    analyzedTasks: tasks.length,
    analyzedFiles: allFiles.size,
  };
}

// ============================================================================
// Utility Exports for Testing
// ============================================================================

export const _testUtils = {
  extractLineRangesFromDiff,
  extractImports,
  extractExports,
  extractFunctionSignatures,
  getEffectiveFilePath,
  rangesOverlap,
  diffToFileChange,
  buildDependencyGraph,
};
