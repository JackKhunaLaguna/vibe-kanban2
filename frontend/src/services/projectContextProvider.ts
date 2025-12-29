/**
 * Project context provider for task generation.
 * Gathers relevant project information to provide context
 * for AI-assisted task generation.
 */

import { projectsApi, tagsApi } from '@/lib/api';
import type { Project, Repo, Tag, TaskWithAttemptStatus } from 'shared/types';
import type { ProjectContext } from './taskGenerationPrompt';

export interface ProjectContextProviderOptions {
  includeExistingTasks?: boolean;
  includeTags?: boolean;
  maxExistingTasks?: number;
}

const DEFAULT_OPTIONS: ProjectContextProviderOptions = {
  includeExistingTasks: true,
  includeTags: true,
  maxExistingTasks: 10,
};

/**
 * Fetches and assembles project context for task generation.
 *
 * @param projectId - The project ID to gather context for
 * @param tasks - Optional array of existing tasks in the project
 * @param options - Configuration options for context gathering
 * @returns ProjectContext object ready for prompt building
 */
export async function getProjectContext(
  project: Project,
  tasks?: TaskWithAttemptStatus[],
  options: ProjectContextProviderOptions = {}
): Promise<ProjectContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Fetch repositories for the project
  const repositories = await fetchProjectRepositories(project.id);

  // Prepare existing tasks if provided and enabled
  const existingTasks =
    opts.includeExistingTasks && tasks
      ? tasks.slice(0, opts.maxExistingTasks).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
        }))
      : undefined;

  // Fetch tags if enabled
  const tags = opts.includeTags ? await fetchTags() : undefined;

  return {
    projectId: project.id,
    projectName: project.name,
    repositories: repositories.map((r) => ({
      id: r.id,
      name: r.display_name || r.name,
      path: r.path,
    })),
    existingTasks,
    tags: tags?.map((t) => ({
      name: t.tag_name,
      content: t.content,
    })),
  };
}

/**
 * Fetches repositories associated with a project.
 */
async function fetchProjectRepositories(projectId: string): Promise<Repo[]> {
  try {
    return await projectsApi.getRepositories(projectId);
  } catch (error) {
    console.warn(
      '[ProjectContextProvider] Failed to fetch repositories:',
      error
    );
    return [];
  }
}

/**
 * Fetches all available tags.
 */
async function fetchTags(): Promise<Tag[]> {
  try {
    return await tagsApi.list();
  } catch (error) {
    console.warn('[ProjectContextProvider] Failed to fetch tags:', error);
    return [];
  }
}

/**
 * Creates a minimal context when full context is not available.
 * Useful for quick task generation without database queries.
 */
export function createMinimalContext(
  projectId: string,
  projectName: string
): ProjectContext {
  return {
    projectId,
    projectName,
    repositories: [],
  };
}

/**
 * Validates that the project context has minimum required fields.
 */
export function validateProjectContext(context: ProjectContext): boolean {
  return !!(
    context.projectId &&
    context.projectName &&
    Array.isArray(context.repositories)
  );
}
