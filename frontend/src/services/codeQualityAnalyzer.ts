/**
 * Code Quality Analyzer Service
 *
 * Analyzes code quality issues within individual tasks by checking for:
 * - TypeScript type errors
 * - Linting violations
 * - Unused variables/imports
 * - Console.log statements in production code
 * - Missing error handling
 * - Security vulnerabilities (basic checks)
 * - Code style inconsistencies
 */

import type { Diff } from '../../../shared/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a file diff associated with a task
 */
export interface TaskDiff {
  taskId: string;
  diffs: Diff[];
}

/**
 * Project context for analysis configuration
 */
export interface ProjectContext {
  projectPath: string;
  hasEslintConfig: boolean;
  hasTsConfig: boolean;
  eslintConfigPath?: string;
  tsConfigPath?: string;
  isProduction?: boolean;
}

/**
 * Represents a code quality issue found during analysis
 */
export interface CodeIssue {
  taskId: string;
  file: string;
  line: number;
  type: 'error' | 'warning' | 'info';
  category: 'typescript' | 'style' | 'security' | 'best-practice';
  message: string;
  suggestedFix?: string;
}

/**
 * Result of the code quality analysis
 */
export interface AnalysisResult {
  issues: CodeIssue[];
  analyzedFiles: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

interface PatternCheck {
  pattern: RegExp;
  type: CodeIssue['type'];
  category: CodeIssue['category'];
  message: string;
  suggestedFix?: string;
  /** If true, only check in production context */
  productionOnly?: boolean;
}

const SECURITY_PATTERNS: PatternCheck[] = [
  {
    pattern: /eval\s*\(/g,
    type: 'error',
    category: 'security',
    message: 'Avoid using eval() - it can execute arbitrary code',
    suggestedFix: 'Use safer alternatives like JSON.parse() or Function constructor',
  },
  {
    pattern: /innerHTML\s*=/g,
    type: 'warning',
    category: 'security',
    message: 'innerHTML can lead to XSS vulnerabilities',
    suggestedFix: 'Use textContent or sanitize HTML before insertion',
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    type: 'warning',
    category: 'security',
    message: 'dangerouslySetInnerHTML can lead to XSS vulnerabilities',
    suggestedFix: 'Sanitize HTML content before using dangerouslySetInnerHTML',
  },
  {
    pattern: /document\.write\s*\(/g,
    type: 'error',
    category: 'security',
    message: 'document.write() is deprecated and can be dangerous',
    suggestedFix: 'Use DOM manipulation methods instead',
  },
  {
    pattern: /new\s+Function\s*\(/g,
    type: 'warning',
    category: 'security',
    message: 'Function constructor can execute arbitrary code',
    suggestedFix: 'Consider safer alternatives',
  },
  {
    pattern: /localStorage\.setItem\s*\([^,]+,\s*[^)]*password/gi,
    type: 'error',
    category: 'security',
    message: 'Avoid storing passwords in localStorage',
    suggestedFix: 'Use secure session management instead',
  },
  {
    pattern: /localStorage\.setItem\s*\([^,]+,\s*[^)]*token/gi,
    type: 'warning',
    category: 'security',
    message: 'Storing tokens in localStorage may be insecure',
    suggestedFix: 'Consider using httpOnly cookies for sensitive tokens',
  },
];

const BEST_PRACTICE_PATTERNS: PatternCheck[] = [
  {
    pattern: /console\.(log|debug|info|warn|error)\s*\(/g,
    type: 'warning',
    category: 'best-practice',
    message: 'Console statement found - remove before production',
    suggestedFix: 'Remove console statement or use a proper logging library',
    productionOnly: true,
  },
  {
    pattern: /debugger\s*;?/g,
    type: 'error',
    category: 'best-practice',
    message: 'Debugger statement found - remove before production',
    suggestedFix: 'Remove debugger statement',
    productionOnly: true,
  },
  {
    pattern: /\/\/\s*TODO\s*:/gi,
    type: 'info',
    category: 'best-practice',
    message: 'TODO comment found',
  },
  {
    pattern: /\/\/\s*FIXME\s*:/gi,
    type: 'warning',
    category: 'best-practice',
    message: 'FIXME comment found - needs attention',
  },
  {
    pattern: /\/\/\s*HACK\s*:/gi,
    type: 'warning',
    category: 'best-practice',
    message: 'HACK comment found - code needs refactoring',
  },
  {
    pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    type: 'warning',
    category: 'best-practice',
    message: 'Empty catch block - errors are being silently ignored',
    suggestedFix: 'Add proper error handling or logging',
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    type: 'warning',
    category: 'best-practice',
    message: 'Empty catch block - errors are being silently ignored',
    suggestedFix: 'Add proper error handling or logging',
  },
  {
    pattern: /Promise\.all\s*\([^)]+\)(?!\s*\.catch)/g,
    type: 'info',
    category: 'best-practice',
    message: 'Promise.all without catch - consider adding error handling',
    suggestedFix: 'Add .catch() or wrap in try/catch',
  },
];

const STYLE_PATTERNS: PatternCheck[] = [
  {
    pattern: /var\s+\w+\s*=/g,
    type: 'warning',
    category: 'style',
    message: 'Use const or let instead of var',
    suggestedFix: 'Replace var with const (for constants) or let (for variables)',
  },
  {
    pattern: /==(?!=)/g,
    type: 'warning',
    category: 'style',
    message: 'Use === instead of == for strict equality',
    suggestedFix: 'Replace == with ===',
  },
  {
    pattern: /!=(?!=)/g,
    type: 'warning',
    category: 'style',
    message: 'Use !== instead of != for strict inequality',
    suggestedFix: 'Replace != with !==',
  },
  {
    pattern: /function\s+\w+\s*\([^)]*\)\s*\{[^}]{500,}\}/gs,
    type: 'info',
    category: 'style',
    message: 'Function is quite long - consider breaking it into smaller functions',
    suggestedFix: 'Extract parts of the function into separate helper functions',
  },
];

const TYPESCRIPT_PATTERNS: PatternCheck[] = [
  {
    pattern: /:\s*any\b/g,
    type: 'warning',
    category: 'typescript',
    message: 'Avoid using "any" type - it defeats the purpose of TypeScript',
    suggestedFix: 'Use a more specific type or unknown',
  },
  {
    pattern: /as\s+any\b/g,
    type: 'warning',
    category: 'typescript',
    message: 'Avoid type assertion to "any"',
    suggestedFix: 'Use a proper type or add appropriate type guards',
  },
  {
    pattern: /@ts-ignore/g,
    type: 'warning',
    category: 'typescript',
    message: '@ts-ignore suppresses type checking - fix the underlying issue',
    suggestedFix: 'Fix the type error or use @ts-expect-error with explanation',
  },
  {
    pattern: /@ts-nocheck/g,
    type: 'error',
    category: 'typescript',
    message: '@ts-nocheck disables type checking for entire file',
    suggestedFix: 'Remove @ts-nocheck and fix type errors',
  },
  {
    pattern: /!\s*\./g,
    type: 'info',
    category: 'typescript',
    message: 'Non-null assertion used - ensure the value is truly never null',
    suggestedFix: 'Add proper null check or use optional chaining',
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract line number from content based on character position
 */
function getLineNumber(content: string, position: number): number {
  const lines = content.substring(0, position).split('\n');
  return lines.length;
}

/**
 * Check if a file is a TypeScript/JavaScript file that should be analyzed
 */
function isAnalyzableFile(filePath: string): boolean {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  return extensions.some((ext) => filePath.endsWith(ext));
}

/**
 * Check if the file is a test file
 */
function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('__tests__') ||
    filePath.includes('__mocks__')
  );
}

/**
 * Check if file is a config file
 */
function isConfigFile(filePath: string): boolean {
  const configPatterns = [
    /\.config\.(ts|js|mjs|cjs)$/,
    /vite\.config/,
    /vitest\.config/,
    /eslint/,
    /prettier/,
    /tailwind/,
    /postcss/,
  ];
  return configPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Run pattern-based checks on content
 */
function runPatternChecks(
  content: string,
  patterns: PatternCheck[],
  taskId: string,
  file: string,
  context: ProjectContext
): CodeIssue[] {
  const issues: CodeIssue[] = [];

  for (const check of patterns) {
    // Skip production-only checks if not in production context
    if (check.productionOnly && !context.isProduction) {
      continue;
    }

    // Reset regex state for global patterns
    check.pattern.lastIndex = 0;

    let match;
    while ((match = check.pattern.exec(content)) !== null) {
      issues.push({
        taskId,
        file,
        line: getLineNumber(content, match.index),
        type: check.type,
        category: check.category,
        message: check.message,
        suggestedFix: check.suggestedFix,
      });
    }
  }

  return issues;
}

/**
 * Check for unused imports in TypeScript/JavaScript files
 */
function checkUnusedImports(
  content: string,
  taskId: string,
  file: string
): CodeIssue[] {
  const issues: CodeIssue[] = [];

  // Simple regex-based unused import detection
  // This is a basic implementation - ESLint does this better
  const importRegex =
    /import\s+(?:(?:\{([^}]+)\})|(?:(\w+)(?:\s*,\s*\{([^}]+)\})?)|(?:\*\s+as\s+(\w+)))\s+from\s+['"][^'"]+['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const namedImports = match[1] || match[3];
    const defaultImport = match[2];
    const namespaceImport = match[4];

    // Check named imports
    if (namedImports) {
      const imports = namedImports.split(',').map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      });

      for (const importName of imports) {
        if (importName && !isImportUsed(content, importName, match.index)) {
          issues.push({
            taskId,
            file,
            line: getLineNumber(content, match.index),
            type: 'warning',
            category: 'style',
            message: `Import '${importName}' appears to be unused`,
            suggestedFix: `Remove unused import '${importName}'`,
          });
        }
      }
    }

    // Check default import
    if (defaultImport && !isImportUsed(content, defaultImport, match.index)) {
      issues.push({
        taskId,
        file,
        line: getLineNumber(content, match.index),
        type: 'warning',
        category: 'style',
        message: `Default import '${defaultImport}' appears to be unused`,
        suggestedFix: `Remove unused import '${defaultImport}'`,
      });
    }

    // Check namespace import
    if (
      namespaceImport &&
      !isImportUsed(content, namespaceImport, match.index)
    ) {
      issues.push({
        taskId,
        file,
        line: getLineNumber(content, match.index),
        type: 'warning',
        category: 'style',
        message: `Namespace import '${namespaceImport}' appears to be unused`,
        suggestedFix: `Remove unused import '${namespaceImport}'`,
      });
    }
  }

  return issues;
}

/**
 * Check if an import is used in the content (simple heuristic)
 */
function isImportUsed(
  content: string,
  importName: string,
  importPosition: number
): boolean {
  // Get content after the import statement
  const contentAfterImport = content.substring(importPosition);

  // Find the end of the import statement
  const importEnd = contentAfterImport.indexOf('\n');
  const restOfContent = contentAfterImport.substring(importEnd);

  // Check if the import name is used (as a word boundary)
  const usageRegex = new RegExp(`\\b${escapeRegExp(importName)}\\b`);
  return usageRegex.test(restOfContent);
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyze a single file's content for code quality issues
 */
function analyzeFileContent(
  content: string,
  taskId: string,
  filePath: string,
  context: ProjectContext
): CodeIssue[] {
  const issues: CodeIssue[] = [];

  // Skip non-analyzable files
  if (!isAnalyzableFile(filePath)) {
    return issues;
  }

  // Determine which checks to apply based on file type
  const isTest = isTestFile(filePath);
  const isConfig = isConfigFile(filePath);

  // Always run security checks
  issues.push(
    ...runPatternChecks(content, SECURITY_PATTERNS, taskId, filePath, context)
  );

  // Run TypeScript checks for TS files
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    issues.push(
      ...runPatternChecks(
        content,
        TYPESCRIPT_PATTERNS,
        taskId,
        filePath,
        context
      )
    );
  }

  // Skip some checks for test files
  if (!isTest) {
    issues.push(
      ...runPatternChecks(
        content,
        BEST_PRACTICE_PATTERNS,
        taskId,
        filePath,
        context
      )
    );
  }

  // Skip style checks for config files
  if (!isConfig) {
    issues.push(
      ...runPatternChecks(content, STYLE_PATTERNS, taskId, filePath, context)
    );

    // Check for unused imports (skip for test/config files)
    if (!isTest) {
      issues.push(...checkUnusedImports(content, taskId, filePath));
    }
  }

  return issues;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyzes code quality issues within task diffs
 *
 * @param tasks - Array of tasks with their file diffs
 * @param projectContext - Project configuration context
 * @returns Promise resolving to array of code quality issues
 */
export async function analyzeQuality(
  tasks: TaskDiff[],
  projectContext: ProjectContext
): Promise<CodeIssue[]> {
  const allIssues: CodeIssue[] = [];

  try {
    for (const task of tasks) {
      for (const diff of task.diffs) {
        // Only analyze added or modified files with new content
        if (
          diff.newContent &&
          (diff.change === 'added' || diff.change === 'modified')
        ) {
          const filePath = diff.newPath || diff.oldPath;
          if (filePath) {
            const issues = analyzeFileContent(
              diff.newContent,
              task.taskId,
              filePath,
              projectContext
            );
            allIssues.push(...issues);
          }
        }
      }
    }
  } catch (error) {
    // Log error but don't fail the analysis
    console.error('Error during code quality analysis:', error);
    throw new CodeQualityAnalysisError(
      `Failed to analyze code quality: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return allIssues;
}

/**
 * Analyze quality and return structured result with summary
 */
export async function analyzeQualityWithSummary(
  tasks: TaskDiff[],
  projectContext: ProjectContext
): Promise<AnalysisResult> {
  const issues = await analyzeQuality(tasks, projectContext);

  const analyzedFiles = new Set<string>();
  for (const task of tasks) {
    for (const diff of task.diffs) {
      const filePath = diff.newPath || diff.oldPath;
      if (
        filePath &&
        isAnalyzableFile(filePath) &&
        (diff.change === 'added' || diff.change === 'modified')
      ) {
        analyzedFiles.add(filePath);
      }
    }
  }

  return {
    issues,
    analyzedFiles: analyzedFiles.size,
    totalIssues: issues.length,
    errorCount: issues.filter((i) => i.type === 'error').length,
    warningCount: issues.filter((i) => i.type === 'warning').length,
    infoCount: issues.filter((i) => i.type === 'info').length,
  };
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Custom error for code quality analysis failures
 */
export class CodeQualityAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeQualityAnalysisError';
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

/**
 * Group issues by category for reporting
 */
export function groupIssuesByCategory(
  issues: CodeIssue[]
): Record<CodeIssue['category'], CodeIssue[]> {
  return {
    typescript: issues.filter((i) => i.category === 'typescript'),
    style: issues.filter((i) => i.category === 'style'),
    security: issues.filter((i) => i.category === 'security'),
    'best-practice': issues.filter((i) => i.category === 'best-practice'),
  };
}

/**
 * Group issues by file for reporting
 */
export function groupIssuesByFile(
  issues: CodeIssue[]
): Record<string, CodeIssue[]> {
  const grouped: Record<string, CodeIssue[]> = {};
  for (const issue of issues) {
    if (!grouped[issue.file]) {
      grouped[issue.file] = [];
    }
    grouped[issue.file].push(issue);
  }
  return grouped;
}

/**
 * Group issues by task for reporting
 */
export function groupIssuesByTask(
  issues: CodeIssue[]
): Record<string, CodeIssue[]> {
  const grouped: Record<string, CodeIssue[]> = {};
  for (const issue of issues) {
    if (!grouped[issue.taskId]) {
      grouped[issue.taskId] = [];
    }
    grouped[issue.taskId].push(issue);
  }
  return grouped;
}

/**
 * Filter issues by severity
 */
export function filterIssuesBySeverity(
  issues: CodeIssue[],
  types: CodeIssue['type'][]
): CodeIssue[] {
  return issues.filter((issue) => types.includes(issue.type));
}

/**
 * Sort issues by severity (error > warning > info)
 */
export function sortIssuesBySeverity(issues: CodeIssue[]): CodeIssue[] {
  const severityOrder: Record<CodeIssue['type'], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return [...issues].sort(
    (a, b) => severityOrder[a.type] - severityOrder[b.type]
  );
}
