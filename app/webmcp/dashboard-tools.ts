import type { ProjectSummary } from '@/lib/domain/scene';
import { toolFailure, toolFailureFromMessage, toolSuccess } from './result';
import type { WebMcpTool } from './types';

const emptyInputSchema = { type: 'object', additionalProperties: false, properties: {} } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export type DashboardToolDependencies = {
  getProjects: () => ProjectSummary[];
  createProject: (name: string | undefined, signal: AbortSignal) => Promise<ProjectSummary>;
  openProject: (projectId: string) => void;
};

export function buildDashboardTools(dependencies: DashboardToolDependencies): WebMcpTool[] {
  return [
    {
      name: 'dwellwise.list_projects',
      title: 'List Dwellwise apartments',
      description: 'List the apartment projects currently loaded for this private browser workspace, newest first. This is read-only.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => toolSuccess('Loaded the apartments in this browser workspace.', {
        data: {
          projects: dependencies.getProjects().slice(0, 100).map(({ id, name, revision, createdAt, updatedAt }) => ({ id, name: name.slice(0, 80), revision, createdAt, updatedAt })),
        },
      }),
    },
    {
      name: 'dwellwise.create_project',
      title: 'Create a Dwellwise apartment',
      description: 'Create and save a new blank apartment in this private browser workspace. This does not navigate away from the dashboard.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80, description: 'Optional user-visible apartment name.' },
        },
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        if (!isRecord(input)) return toolFailure('INVALID_INPUT', 'Input must be an object.');
        const rawName = input.name;
        if (rawName !== undefined && (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 80)) {
          return toolFailure('INVALID_INPUT', 'name must be between 1 and 80 characters.');
        }
        try {
          const project = await dependencies.createProject(typeof rawName === 'string' ? rawName.trim() : undefined, signal);
          return toolSuccess(`Created apartment “${project.name.slice(0, 80)}”.`, {
            projectId: project.id,
            revision: project.revision,
            data: { project: { id: project.id, name: project.name.slice(0, 80), revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt } },
          });
        } catch (error) {
          if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
          return toolFailureFromMessage(error instanceof Error ? error.message : 'The apartment could not be created. Check your connection and try again.');
        }
      },
    },
    {
      name: 'dwellwise.open_project',
      title: 'Open a Dwellwise apartment',
      description: 'Navigate this page from the dashboard to an apartment that is already listed in this browser workspace. This changes the current page.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', minLength: 1, maxLength: 128, description: 'An apartment ID returned by dwellwise.list_projects.' },
        },
        required: ['projectId'],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (!isRecord(input) || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 128) {
          return toolFailure('INVALID_INPUT', 'projectId must be a non-empty string of at most 128 characters.');
        }
        const project = dependencies.getProjects().find((candidate) => candidate.id === input.projectId);
        if (!project) return toolFailure('NOT_FOUND', 'That apartment is not available in the current dashboard.');
        dependencies.openProject(project.id);
        return toolSuccess(`Opening apartment “${project.name.slice(0, 80)}”.`, { projectId: project.id, revision: project.revision });
      },
    },
  ];
}
