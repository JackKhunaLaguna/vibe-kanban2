/**
 * Project Patterns Service
 *
 * Detects and stores patterns in project development.
 * Helps the orchestrator understand project-specific patterns.
 */

// Pattern data type definitions
export interface TechStackPattern {
  languages: string[];
  frameworks: string[];
  libraries: string[];
}

export interface ConventionsPattern {
  namingStyle: string;
  fileStructure: string;
  importStyle?: string;
  componentPattern?: string;
}

export interface WorkflowPattern {
  branchStrategy: string;
  reviewProcess: string;
  ciPipeline?: string;
}

export interface TestingPattern {
  framework: string;
  coverage: string;
  testLocation?: string;
}

export type PatternData =
  | TechStackPattern
  | ConventionsPattern
  | WorkflowPattern
  | TestingPattern
  | Record<string, unknown>;

export type PatternType =
  | 'tech_stack'
  | 'conventions'
  | 'workflow'
  | 'testing'
  | string;

export interface Pattern {
  id: string;
  projectId: string;
  patternType: PatternType;
  patternData: PatternData;
  observedCount: number;
  lastObservedAt: Date;
}

// Simple in-memory storage (can be extended to use a proper database)
class OrchestratorDb {
  private patterns: Map<string, Pattern> = new Map();

  private getKey(projectId: string, patternType: string): string {
    return `${projectId}:${patternType}`;
  }

  save(pattern: Pattern): void {
    const key = this.getKey(pattern.projectId, pattern.patternType);
    this.patterns.set(key, pattern);
  }

  get(projectId: string, patternType: string): Pattern | null {
    const key = this.getKey(projectId, patternType);
    return this.patterns.get(key) ?? null;
  }

  getAllForProject(projectId: string): Pattern[] {
    const results: Pattern[] = [];
    for (const pattern of this.patterns.values()) {
      if (pattern.projectId === projectId) {
        results.push(pattern);
      }
    }
    return results;
  }

  delete(projectId: string, patternType: string): boolean {
    const key = this.getKey(projectId, patternType);
    return this.patterns.delete(key);
  }

  clear(): void {
    this.patterns.clear();
  }
}

// Pattern analysis helpers
function generatePatternId(): string {
  return `pattern_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function detectNamingStyle(fileNames: string[]): string {
  const styles = {
    kebab: 0,
    snake: 0,
    camel: 0,
    pascal: 0,
  };

  for (const name of fileNames) {
    const baseName = name.replace(/\.[^/.]+$/, '');
    if (baseName.includes('-')) styles.kebab++;
    else if (baseName.includes('_')) styles.snake++;
    else if (/^[a-z]/.test(baseName) && /[A-Z]/.test(baseName)) styles.camel++;
    else if (/^[A-Z]/.test(baseName)) styles.pascal++;
  }

  const maxStyle = Object.entries(styles).reduce((a, b) =>
    a[1] > b[1] ? a : b
  );
  return maxStyle[0];
}

function detectImportStyle(imports: string[]): string {
  const hasAbsolute = imports.some(
    (i) => !i.startsWith('.') && !i.startsWith('@/')
  );
  const hasAliased = imports.some((i) => i.startsWith('@/'));
  const hasRelative = imports.some((i) => i.startsWith('.'));

  if (hasAliased) return 'aliased';
  if (hasAbsolute && !hasRelative) return 'absolute';
  if (!hasAbsolute && hasRelative) return 'relative';
  return 'mixed';
}

function analyzePackageJson(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}): TechStackPattern {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const depNames = Object.keys(deps);

  const languages: string[] = [];
  const frameworks: string[] = [];
  const libraries: string[] = [];

  // Detect languages
  if (depNames.some((d) => d === 'typescript' || d.startsWith('@types/'))) {
    languages.push('TypeScript');
  }
  if (
    packageJson.scripts &&
    Object.values(packageJson.scripts).some((s) => s.includes('node'))
  ) {
    languages.push('JavaScript');
  }

  // Detect frameworks
  const frameworkMap: Record<string, string> = {
    react: 'React',
    vue: 'Vue',
    angular: 'Angular',
    svelte: 'Svelte',
    next: 'Next.js',
    nuxt: 'Nuxt',
    express: 'Express',
    fastify: 'Fastify',
    nestjs: 'NestJS',
    '@nestjs/core': 'NestJS',
  };

  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (depNames.includes(dep)) {
      frameworks.push(name);
    }
  }

  // Detect common libraries
  const libraryMap: Record<string, string> = {
    axios: 'Axios',
    lodash: 'Lodash',
    moment: 'Moment.js',
    dayjs: 'Day.js',
    tailwindcss: 'Tailwind CSS',
    'styled-components': 'Styled Components',
    '@emotion/react': 'Emotion',
    redux: 'Redux',
    zustand: 'Zustand',
    '@tanstack/react-query': 'React Query',
    prisma: 'Prisma',
    sequelize: 'Sequelize',
    mongoose: 'Mongoose',
  };

  for (const [dep, name] of Object.entries(libraryMap)) {
    if (depNames.includes(dep)) {
      libraries.push(name);
    }
  }

  return { languages, frameworks, libraries };
}

function detectTestingFramework(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): TestingPattern {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const depNames = Object.keys(deps);

  let framework = 'unknown';
  let coverage = 'unknown';
  let testLocation = 'unknown';

  // Detect test framework
  if (depNames.includes('jest')) framework = 'Jest';
  else if (depNames.includes('vitest')) framework = 'Vitest';
  else if (depNames.includes('mocha')) framework = 'Mocha';
  else if (depNames.includes('@playwright/test')) framework = 'Playwright';
  else if (depNames.includes('cypress')) framework = 'Cypress';

  // Detect coverage tools
  if (depNames.includes('nyc') || depNames.includes('istanbul')) {
    coverage = 'Istanbul/NYC';
  } else if (depNames.includes('@vitest/coverage-v8')) {
    coverage = 'V8 Coverage';
  } else if (depNames.includes('@vitest/coverage-istanbul')) {
    coverage = 'Istanbul';
  }

  return { framework, coverage, testLocation };
}

// Main service class
class ProjectPatternsService {
  private db: OrchestratorDb;

  constructor(db?: OrchestratorDb) {
    this.db = db ?? new OrchestratorDb();
  }

  /**
   * Records observation of a pattern.
   * Increments observed_count if pattern exists.
   * Creates new pattern if first observation.
   */
  observePattern(
    projectId: string,
    patternType: PatternType,
    patternData: PatternData
  ): void {
    const existing = this.db.get(projectId, patternType);

    if (existing) {
      existing.observedCount++;
      existing.lastObservedAt = new Date();
      existing.patternData = this.mergePatternData(
        existing.patternData,
        patternData
      );
      this.db.save(existing);
    } else {
      const pattern: Pattern = {
        id: generatePatternId(),
        projectId,
        patternType,
        patternData,
        observedCount: 1,
        lastObservedAt: new Date(),
      };
      this.db.save(pattern);
    }
  }

  /**
   * Retrieves specific pattern.
   * Returns null if not observed.
   */
  getPattern(projectId: string, patternType: PatternType): Pattern | null {
    return this.db.get(projectId, patternType);
  }

  /**
   * Gets all patterns for project.
   * Sorted by observed_count (most common first).
   */
  getAllPatterns(projectId: string): Pattern[] {
    const patterns = this.db.getAllForProject(projectId);
    return patterns.sort((a, b) => b.observedCount - a.observedCount);
  }

  /**
   * Analyzes project files (package.json, etc.)
   * Stores as 'tech_stack' pattern.
   */
  detectTechStack(
    projectId: string,
    packageJson?: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    }
  ): void {
    if (!packageJson) {
      // If no package.json provided, create empty pattern
      this.observePattern(projectId, 'tech_stack', {
        languages: [],
        frameworks: [],
        libraries: [],
      } as TechStackPattern);
      return;
    }

    const techStack = analyzePackageJson(packageJson);
    this.observePattern(projectId, 'tech_stack', techStack);
  }

  /**
   * Analyzes code patterns.
   * Stores as 'conventions' pattern.
   */
  detectConventions(
    projectId: string,
    context?: {
      fileNames?: string[];
      imports?: string[];
      hasEslint?: boolean;
      hasPrettier?: boolean;
    }
  ): void {
    const conventions: ConventionsPattern = {
      namingStyle: 'unknown',
      fileStructure: 'unknown',
    };

    if (context?.fileNames && context.fileNames.length > 0) {
      conventions.namingStyle = detectNamingStyle(context.fileNames);
    }

    if (context?.imports && context.imports.length > 0) {
      conventions.importStyle = detectImportStyle(context.imports);
    }

    // Detect file structure patterns
    if (context?.fileNames) {
      const hasComponentsDir = context.fileNames.some((f) =>
        f.includes('components/')
      );
      const hasPagesDir = context.fileNames.some((f) => f.includes('pages/'));
      const hasSrcDir = context.fileNames.some((f) => f.startsWith('src/'));

      if (hasSrcDir && hasComponentsDir && hasPagesDir) {
        conventions.fileStructure = 'feature-based';
      } else if (hasComponentsDir) {
        conventions.fileStructure = 'component-based';
      } else if (hasSrcDir) {
        conventions.fileStructure = 'src-based';
      }
    }

    // Detect component patterns (for React projects)
    if (context?.fileNames) {
      const hasFunctionalComponents = context.fileNames.some(
        (f) => f.endsWith('.tsx') || f.endsWith('.jsx')
      );
      if (hasFunctionalComponents) {
        conventions.componentPattern = 'functional';
      }
    }

    this.observePattern(projectId, 'conventions', conventions);
  }

  /**
   * Detects workflow patterns from git configuration.
   */
  detectWorkflow(
    projectId: string,
    context?: {
      branches?: string[];
      hasGithubActions?: boolean;
      hasCircleCI?: boolean;
      hasPRTemplate?: boolean;
    }
  ): void {
    const workflow: WorkflowPattern = {
      branchStrategy: 'unknown',
      reviewProcess: 'unknown',
    };

    if (context?.branches) {
      const hasMain = context.branches.includes('main');
      const hasMaster = context.branches.includes('master');
      const hasDevelop = context.branches.includes('develop');
      const hasFeatureBranches = context.branches.some((b) =>
        b.startsWith('feature/')
      );
      const hasReleaseBranches = context.branches.some((b) =>
        b.startsWith('release/')
      );

      if (hasDevelop && hasFeatureBranches && hasReleaseBranches) {
        workflow.branchStrategy = 'gitflow';
      } else if ((hasMain || hasMaster) && hasFeatureBranches) {
        workflow.branchStrategy = 'feature-branch';
      } else if (hasMain || hasMaster) {
        workflow.branchStrategy = 'trunk-based';
      }
    }

    if (context?.hasGithubActions) {
      workflow.ciPipeline = 'GitHub Actions';
    } else if (context?.hasCircleCI) {
      workflow.ciPipeline = 'CircleCI';
    }

    if (context?.hasPRTemplate) {
      workflow.reviewProcess = 'PR-based';
    }

    this.observePattern(projectId, 'workflow', workflow);
  }

  /**
   * Detects testing patterns from project configuration.
   */
  detectTesting(
    projectId: string,
    packageJson?: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }
  ): void {
    if (!packageJson) {
      this.observePattern(projectId, 'testing', {
        framework: 'unknown',
        coverage: 'unknown',
      } as TestingPattern);
      return;
    }

    const testing = detectTestingFramework(packageJson);
    this.observePattern(projectId, 'testing', testing);
  }

  /**
   * Merges pattern data, combining arrays and updating values.
   */
  private mergePatternData(
    existing: PatternData,
    incoming: PatternData
  ): PatternData {
    const merged: Record<string, unknown> = { ...existing };

    for (const [key, value] of Object.entries(incoming)) {
      const existingValue = merged[key];
      if (Array.isArray(value) && Array.isArray(existingValue)) {
        // Merge arrays and deduplicate
        merged[key] = [...new Set([...existingValue, ...value])];
      } else if (value !== undefined && value !== null && value !== 'unknown') {
        merged[key] = value;
      }
    }

    return merged as PatternData;
  }

  /**
   * Clears all patterns for a project.
   */
  clearPatterns(projectId: string): void {
    const patterns = this.getAllPatterns(projectId);
    for (const pattern of patterns) {
      this.db.delete(projectId, pattern.patternType);
    }
  }

  /**
   * Gets the underlying database instance.
   * Useful for testing or extending functionality.
   */
  getDb(): OrchestratorDb {
    return this.db;
  }
}

// Export singleton instance
export const orchestratorDb = new OrchestratorDb();
export const projectPatternsService = new ProjectPatternsService(orchestratorDb);

// Also export the class for testing or custom instances
export { ProjectPatternsService, OrchestratorDb };
