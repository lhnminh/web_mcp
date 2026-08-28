import type { ProjectSummary } from '@/lib/domain/scene';
import { consistencyFingerprint, pageInputSchemaProperties, paginate, parsePageInput } from './pagination';
import { toolFailure, toolFailureFromMessage, toolSuccess } from './result';
import { renameProjectInputSchema } from './schemas';
import type { WebMcpTool } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export type DashboardToolDependencies = {
  getProjects: () => ProjectSummary[];
  refreshProjects: (signal: AbortSignal) => Promise<ProjectSummary[]>;
  createProject: (name: string | undefined, signal: AbortSignal) => Promise<ProjectSummary>;
  renameProject: (projectId: string, name: string, signal: AbortSignal) => Promise<ProjectSummary>;
  prepareDeleteProject: (project: ProjectSummary) => void;
  openProject: (projectId: string) => void;
};

const projectProjection = ({ id, name, revision, createdAt, updatedAt }: ProjectSummary) => ({ id, name: name.slice(0, 80), revision, createdAt, updatedAt });

export function buildDashboardTools(dependencies: DashboardToolDependencies): WebMcpTool[] {
  return [
    {
      name: 'dwellwise.list_projects',
      title: 'List Dwellwise apartments',
      description: 'Refresh the visible dashboard and return one page of apartment projects in this private browser workspace, newest first. This is read-only.',
      inputSchema: { type: 'object', additionalProperties: false, properties: pageInputSchemaProperties },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        if (!isRecord(input)) return toolFailure('INVALID_INPUT', 'Input must be an object.');
        try {
          const projects = await dependencies.refreshProjects(signal);
          const consistency = consistencyFingerprint(projects.map((project) => `${project.id}:${project.revision}:${project.updatedAt}`).join('|'));
          const page = parsePageInput(input, { scope: 'projects', consistency });
          if ('ok' in page) return page;
          const result = paginate(projects, page, { scope: 'projects', consistency });
          return toolSuccess('Loaded the apartments in this browser workspace.', {
            data: { projects: result.items.map(projectProjection), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) },
          });
        } catch (error) {
          if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
          return toolFailureFromMessage(error instanceof Error ? error.message : 'Projects could not be refreshed.');
        }
      },
    },
    {
      name: 'dwellwise.rename_project',
      title: 'Rename a Dwellwise apartment',
      description: 'Rename and save an owned apartment from the dashboard. Use a project ID returned by dwellwise.list_projects.',
      inputSchema: renameProjectInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        if (!isRecord(input) || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 128 || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) {
          return toolFailure('INVALID_INPUT', 'projectId and a name between 1 and 80 characters are required on the dashboard.');
        }
        if (!dependencies.getProjects().some((project) => project.id === input.projectId)) return toolFailure('NOT_FOUND', 'That apartment is not available in the current dashboard.');
        try {
          const project = await dependencies.renameProject(input.projectId, input.name.trim(), signal);
          return toolSuccess(`Renamed the apartment to “${project.name.slice(0, 80)}”.`, { projectId: project.id, revision: project.revision, data: { project: projectProjection(project) } });
        } catch (error) {
          if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
          return toolFailureFromMessage(error instanceof Error ? error.message : 'The apartment could not be renamed.');
        }
      },
    },
    {
      name: 'dwellwise.prepare_delete_project',
      title: 'Prepare deletion of a Dwellwise apartment',
      description: 'Display a visible human confirmation for deleting one owned apartment. This tool never deletes the project or accepts agent confirmation.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['projectId'] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (!isRecord(input) || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 128) return toolFailure('INVALID_INPUT', 'projectId is required.');
        const project = dependencies.getProjects().find((candidate) => candidate.id === input.projectId);
        if (!project) return toolFailure('NOT_FOUND', 'That apartment is not available in the current dashboard.');
        dependencies.prepareDeleteProject(project);
        return toolFailure('CONFIRMATION_REQUIRED', 'Review the visible deletion confirmation in Dwellwise. Only a human can complete this action.', {
          data: { saved: false, targetType: 'project', targetId: project.id, targetRevision: project.revision },
        });
      },
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
