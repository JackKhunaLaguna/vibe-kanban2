import { projectsApi, handleApiResponse } from '@/lib/api';
import type { Repo } from 'shared/types';

/**
 * Context information about a project to enhance AI task generation.
 */
export interface ProjectContext {
  projectName: string;
  techStack: string[];
  primaryLanguage: string;
  framework?: string;
  description?: string;
}

/**
 * Extended package.json structure for analysis
 */
interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/**
 * File content response from backend
 */
interface FileContentResponse {
  content: string;
}

// Cache for project contexts to avoid repeated file system reads
const contextCache = new Map<
  string,
  { context: ProjectContext; timestamp: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Known frameworks and their detection patterns
 */
const FRAMEWORK_PATTERNS: Record<string, string[]> = {
  'Next.js': ['next'],
  React: ['react', 'react-dom'],
  Vue: ['vue'],
  Angular: ['@angular/core'],
  Svelte: ['svelte'],
  'Nuxt.js': ['nuxt'],
  Remix: ['@remix-run/react'],
  Astro: ['astro'],
  'Express.js': ['express'],
  NestJS: ['@nestjs/core'],
  Fastify: ['fastify'],
  Koa: ['koa'],
  Hono: ['hono'],
  Electron: ['electron'],
  'React Native': ['react-native'],
  Expo: ['expo'],
  Gatsby: ['gatsby'],
  'Vite + React': ['vite', 'react'],
};

/**
 * Known tech stack items and their detection patterns
 */
const TECH_STACK_PATTERNS: Record<string, string[]> = {
  TypeScript: ['typescript'],
  Tailwind: ['tailwindcss'],
  Prisma: ['prisma', '@prisma/client'],
  GraphQL: ['graphql', '@apollo/client', 'apollo-server'],
  Redux: ['redux', '@reduxjs/toolkit'],
  Zustand: ['zustand'],
  Jotai: ['jotai'],
  TanStack: ['@tanstack/react-query', '@tanstack/react-table'],
  Jest: ['jest'],
  Vitest: ['vitest'],
  Playwright: ['@playwright/test'],
  Cypress: ['cypress'],
  ESLint: ['eslint'],
  Prettier: ['prettier'],
  Webpack: ['webpack'],
  Vite: ['vite'],
  Turbo: ['turbo'],
  Docker: [], // detected via Dockerfile
  PostgreSQL: ['pg', 'postgres'],
  MongoDB: ['mongodb', 'mongoose'],
  Redis: ['redis', 'ioredis'],
  SQLite: ['better-sqlite3', 'sqlite3'],
  Drizzle: ['drizzle-orm'],
  Zod: ['zod'],
  tRPC: ['@trpc/server', '@trpc/client'],
};

/**
 * Fetches file content from a repository path
 */
async function fetchFileContent(
  repoPath: string,
  filePath: string
): Promise<string | null> {
  try {
    const fullPath = `${repoPath}/${filePath}`;
    const response = await fetch(
      `/api/filesystem/file?path=${encodeURIComponent(fullPath)}`
    );

    if (!response.ok) {
      return null;
    }

    const result = await handleApiResponse<FileContentResponse>(response);
    return result.content;
  } catch {
    return null;
  }
}

/**
 * Checks if a file exists at the given path
 */
async function fileExists(
  repoPath: string,
  filePath: string
): Promise<boolean> {
  try {
    const fullPath = `${repoPath}/${filePath}`;
    const response = await fetch(
      `/api/filesystem/exists?path=${encodeURIComponent(fullPath)}`
    );

    if (!response.ok) {
      return false;
    }

    const result = await response.json();
    return result.data?.exists ?? false;
  } catch {
    return false;
  }
}

/**
 * Parses package.json content safely
 */
function parsePackageJson(content: string): PackageJson | null {
  try {
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Detects tech stack from package.json dependencies
 */
function detectTechStack(packageJson: PackageJson): string[] {
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const depNames = Object.keys(allDeps);
  const techStack: string[] = [];

  for (const [tech, patterns] of Object.entries(TECH_STACK_PATTERNS)) {
    if (patterns.length === 0) continue;
    if (patterns.some((pattern) => depNames.includes(pattern))) {
      techStack.push(tech);
    }
  }

  return techStack;
}

/**
 * Detects the primary framework from package.json
 */
function detectFramework(packageJson: PackageJson): string | undefined {
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const depNames = Object.keys(allDeps);

  // Check frameworks in order of specificity (more specific first)
  const frameworkOrder = [
    'Nuxt.js',
    'Next.js',
    'Remix',
    'Gatsby',
    'Astro',
    'Expo',
    'React Native',
    'NestJS',
    'Electron',
    'Vite + React',
    'Angular',
    'Vue',
    'Svelte',
    'React',
    'Fastify',
    'Hono',
    'Express.js',
    'Koa',
  ];

  for (const framework of frameworkOrder) {
    const patterns = FRAMEWORK_PATTERNS[framework];
    if (patterns && patterns.every((pattern) => depNames.includes(pattern))) {
      return framework;
    }
  }

  return undefined;
}

/**
 * Detects the primary language from project files
 */
async function detectPrimaryLanguage(
  repoPath: string,
  packageJson: PackageJson | null
): Promise<string> {
  // Check for TypeScript
  if (packageJson) {
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    if (
      allDeps['typescript'] ||
      Object.keys(allDeps).some((dep) => dep.startsWith('@types/'))
    ) {
      return 'TypeScript';
    }
  }

  // Check for other language config files
  if (await fileExists(repoPath, 'Cargo.toml')) {
    return 'Rust';
  }

  if (
    (await fileExists(repoPath, 'requirements.txt')) ||
    (await fileExists(repoPath, 'pyproject.toml')) ||
    (await fileExists(repoPath, 'setup.py'))
  ) {
    return 'Python';
  }

  if (await fileExists(repoPath, 'go.mod')) {
    return 'Go';
  }

  if (await fileExists(repoPath, 'pom.xml')) {
    return 'Java';
  }

  if (await fileExists(repoPath, 'build.gradle')) {
    return 'Java/Kotlin';
  }

  if (await fileExists(repoPath, 'Package.swift')) {
    return 'Swift';
  }

  // Default to JavaScript if package.json exists
  if (packageJson) {
    return 'JavaScript';
  }

  return 'Unknown';
}

/**
 * Detects additional tech from project files
 */
async function detectAdditionalTech(repoPath: string): Promise<string[]> {
  const additionalTech: string[] = [];

  // Check for Docker
  if (
    (await fileExists(repoPath, 'Dockerfile')) ||
    (await fileExists(repoPath, 'docker-compose.yml')) ||
    (await fileExists(repoPath, 'docker-compose.yaml'))
  ) {
    additionalTech.push('Docker');
  }

  // Check for CI/CD
  if (await fileExists(repoPath, '.github/workflows')) {
    additionalTech.push('GitHub Actions');
  }

  return additionalTech;
}

/**
 * Gathers project context from a single repository
 */
async function gatherRepoContext(repo: Repo): Promise<Partial<ProjectContext>> {
  const context: Partial<ProjectContext> = {
    techStack: [],
  };

  // Try to read package.json
  const packageJsonContent = await fetchFileContent(repo.path, 'package.json');
  const packageJson = packageJsonContent
    ? parsePackageJson(packageJsonContent)
    : null;

  if (packageJson) {
    // Use package.json name as potential project name
    if (packageJson.name) {
      context.projectName = packageJson.name;
    }

    // Use package.json description
    if (packageJson.description) {
      context.description = packageJson.description;
    }

    // Detect tech stack
    context.techStack = detectTechStack(packageJson);

    // Detect framework
    context.framework = detectFramework(packageJson);
  }

  // Detect primary language
  context.primaryLanguage = await detectPrimaryLanguage(repo.path, packageJson);

  // Detect additional tech (Docker, etc.)
  const additionalTech = await detectAdditionalTech(repo.path);
  context.techStack = [...(context.techStack || []), ...additionalTech];

  return context;
}

/**
 * Merges multiple repo contexts into a single project context
 */
function mergeContexts(
  projectName: string,
  contexts: Partial<ProjectContext>[]
): ProjectContext {
  const allTechStack = new Set<string>();
  const frameworks = new Set<string>();
  const languages = new Set<string>();
  let description: string | undefined;

  for (const ctx of contexts) {
    if (ctx.techStack) {
      ctx.techStack.forEach((tech) => allTechStack.add(tech));
    }
    if (ctx.framework) {
      frameworks.add(ctx.framework);
    }
    if (ctx.primaryLanguage && ctx.primaryLanguage !== 'Unknown') {
      languages.add(ctx.primaryLanguage);
    }
    if (ctx.description && !description) {
      description = ctx.description;
    }
  }

  // Determine primary language (prefer TypeScript over JavaScript)
  let primaryLanguage = 'Unknown';
  if (languages.has('TypeScript')) {
    primaryLanguage = 'TypeScript';
  } else if (languages.size > 0) {
    primaryLanguage = Array.from(languages)[0];
  }

  // Use first framework found, or combine if multiple
  const framework =
    frameworks.size > 0 ? Array.from(frameworks).join(' + ') : undefined;

  return {
    projectName,
    techStack: Array.from(allTechStack),
    primaryLanguage,
    framework,
    description,
  };
}

/**
 * Gets the cached context if valid, or null if expired/missing
 */
function getCachedContext(projectId: string): ProjectContext | null {
  const cached = contextCache.get(projectId);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    contextCache.delete(projectId);
    return null;
  }

  return cached.context;
}

/**
 * Caches the project context
 */
function cacheContext(projectId: string, context: ProjectContext): void {
  contextCache.set(projectId, {
    context,
    timestamp: Date.now(),
  });
}

/**
 * Clears the cache for a specific project
 */
export function clearProjectContextCache(projectId: string): void {
  contextCache.delete(projectId);
}

/**
 * Clears all cached project contexts
 */
export function clearAllProjectContextCaches(): void {
  contextCache.clear();
}

/**
 * Gathers relevant project context to enhance AI task generation.
 *
 * This function analyzes the project's repositories to detect:
 * - Tech stack (from package.json, Cargo.toml, etc.)
 * - Primary programming language
 * - Framework being used (Next.js, React, etc.)
 * - Project description (from package.json)
 *
 * Results are cached for 5 minutes to avoid repeated file system reads.
 *
 * @param projectId - The ID of the project to gather context for
 * @returns ProjectContext with detected information, or a minimal context if unavailable
 */
export async function getProjectContext(
  projectId: string
): Promise<ProjectContext> {
  // Check cache first
  const cached = getCachedContext(projectId);
  if (cached) {
    return cached;
  }

  try {
    // Get project repositories
    const repos = await projectsApi.getRepositories(projectId);

    if (repos.length === 0) {
      // Return minimal context for projects without repositories
      const minimalContext: ProjectContext = {
        projectName: 'Unknown Project',
        techStack: [],
        primaryLanguage: 'Unknown',
      };
      cacheContext(projectId, minimalContext);
      return minimalContext;
    }

    // Gather context from all repositories in parallel
    const repoContexts = await Promise.all(repos.map(gatherRepoContext));

    // Use the first repo's display name as project name, or fall back to name
    const projectName =
      repos[0].display_name || repos[0].name || 'Unknown Project';

    // Merge all contexts
    const mergedContext = mergeContexts(projectName, repoContexts);

    // Cache the result
    cacheContext(projectId, mergedContext);

    return mergedContext;
  } catch (error) {
    // Handle errors gracefully - return minimal context
    console.error('Failed to gather project context:', error);

    const fallbackContext: ProjectContext = {
      projectName: 'Unknown Project',
      techStack: [],
      primaryLanguage: 'Unknown',
      description: 'Unable to detect project context',
    };

    // Cache even the fallback to avoid repeated failed requests
    cacheContext(projectId, fallbackContext);

    return fallbackContext;
  }
}
