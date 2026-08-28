'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProjectSummary } from '@/lib/domain/scene';
import { useWebMcpTools } from '@/app/hooks/use-webmcp-tools';
import { buildDashboardTools } from '@/app/webmcp/dashboard-tools';
import DestructiveConfirmationDialog from '@/app/DestructiveConfirmationDialog';

const updatedLabel = (timestamp: string) => {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return 'Recently edited';
  return `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: value.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(value)}`;
};

export default function ProjectsDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ projectId: string; projectName: string; revision: number } | null>(null);

  useEffect(() => {
    if (!pendingDelete) return;
    const timeout = window.setTimeout(() => setPendingDelete((current) => current === pendingDelete ? null : current), 60_000);
    return () => window.clearTimeout(timeout);
  }, [pendingDelete]);

  const loadProjects = async (signal?: AbortSignal) => {
    setError('');
    try {
      const response = await fetch('/api/projects', { cache: 'no-store', signal });
      const result = await response.json() as { projects?: ProjectSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Projects could not be loaded.');
      const nextProjects = result.projects ?? [];
      setProjects(nextProjects);
      setPendingDelete((current) => {
        if (!current) return null;
        const target = nextProjects.find((project) => project.id === current.projectId);
        return target && target.revision === current.revision ? current : null;
      });
      return nextProjects;
    } catch (loadError) {
      if (signal?.aborted || (loadError instanceof Error && loadError.name === 'AbortError')) throw loadError;
      setError(loadError instanceof Error ? loadError.message : 'Projects could not be loaded.');
      throw loadError;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { projects?: ProjectSummary[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Projects could not be loaded.');
        return result.projects ?? [];
      })
      .then((result) => {
        if (cancelled) return;
        setProjects(result);
        setPendingDelete((current) => {
          if (!current) return null;
          const target = result.find((project) => project.id === current.projectId);
          return target && target.revision === current.revision ? current : null;
        });
      })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const createProjectRecord = async (name?: string, signal?: AbortSignal) => {
    if (creating || loading) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
        signal,
      });
      const result = await response.json() as ProjectSummary & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The apartment could not be created.');
      setProjects((current) => [result, ...current.filter((project) => project.id !== result.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      return result;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The apartment could not be created.');
      throw createError;
    } finally {
      setCreating(false);
    }
  };

  const createProject = async () => {
    try {
      const result = await createProjectRecord();
      if (result) router.push(`/projects/${encodeURIComponent(result.id)}`);
    } catch {
      // createProjectRecord keeps the visible error state current.
    }
  };

  const beginRename = (project: ProjectSummary) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
    setError('');
  };

  const renameProjectRecord = async (projectId: string, name: string, signal?: AbortSignal) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('That apartment is not available in the current dashboard.');
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 80) throw new Error('The apartment name must be between 1 and 80 characters.');
    if (trimmedName === project.name) return project;
    if (busyId) throw new Error('The dashboard is busy. Try again in a moment.');
    setBusyId(project.id);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, expectedRevision: project.revision }),
        signal,
      });
      const result = await response.json() as ProjectSummary & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The project could not be renamed.');
      setProjects((current) => current.map((item) => item.id === project.id ? result : item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setPendingDelete((current) => current?.projectId === result.id && current.revision !== result.revision ? null : current);
      setRenamingId('');
      return result;
    } catch (renameError) {
      if (signal?.aborted || (renameError instanceof Error && renameError.name === 'AbortError')) throw renameError;
      try {
        await loadProjects();
      } catch {
        // Preserve the more actionable rename error after a best-effort refresh.
      }
      setError(renameError instanceof Error ? renameError.message : 'The project could not be renamed.');
      throw renameError;
    } finally {
      setBusyId('');
    }
  };

  const renameProject = async (event: FormEvent, project: ProjectSummary) => {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || name === project.name) {
      setRenamingId('');
      return;
    }
    try {
      await renameProjectRecord(project.id, name);
    } catch {
      // renameProjectRecord keeps the visible error state current.
    }
  };

  const prepareDeleteProject = (project: ProjectSummary) => {
    if (busyId) return;
    setPendingDelete({ projectId: project.id, projectName: project.name, revision: project.revision });
  };

  const removeProject = async (project: ProjectSummary) => {
    if (busyId) return;
    const current = projects.find((candidate) => candidate.id === project.id);
    if (!current || current.revision !== project.revision) {
      setPendingDelete(null);
      setError('That apartment changed before deletion could be confirmed. Review it and try again.');
      return;
    }
    setBusyId(project.id);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The project could not be deleted.');
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The project could not be deleted.');
    } finally {
      setBusyId('');
    }
  };

  useWebMcpTools(buildDashboardTools({
    getProjects: () => projects,
    refreshProjects: (signal) => loadProjects(signal),
    createProject: async (name, signal) => {
      const project = await createProjectRecord(name, signal);
      if (!project) throw new Error('The dashboard is busy. Try again in a moment.');
      return project;
    },
    renameProject: (projectId, name, signal) => renameProjectRecord(projectId, name, signal),
    prepareDeleteProject,
    openProject: (projectId) => { setPendingDelete(null); router.push(`/projects/${encodeURIComponent(projectId)}`); },
  }), !loading);

  return (
    <main className="projects-dashboard">
      <header className="dashboard-header">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></div>
        <div className="browser-profile-badge"><i /> This browser</div>
      </header>

      <section className="dashboard-content">
        <div className="dashboard-intro">
          <div><span className="eyebrow">YOUR WORKSPACE</span><h1>Your apartments</h1><p>Create a plan or return to an apartment you have already started. These projects are saved privately in this browser.</p></div>
          <button className="create-project-button" onClick={createProject} disabled={creating || loading}>{creating ? 'Creating…' : loading ? 'Loading…' : '＋ Create apartment'}</button>
        </div>

        {error && <div className="dashboard-error" role="alert"><span>{error}</span><button onClick={() => void loadProjects()}>Try again</button></div>}

        {loading ? (
          <div className="dashboard-loading">Loading your apartments…</div>
        ) : projects.length === 0 ? (
          <section className="empty-projects">
            <div className="empty-plan-mark"><i /><i /><span /></div>
            <span>NO APARTMENTS YET</span>
            <h2>Start with a blank floor plan.</h2>
            <p>Build the architecture, place your furniture, and preview the space in 3D.</p>
            <button onClick={createProject} disabled={creating}>{creating ? 'Creating apartment…' : 'Create your first apartment'}</button>
            <small>Projects stay available in this browser. No account required.</small>
          </section>
        ) : (
          <section className="project-list" aria-label="Saved apartments">
            <div className="project-list-heading"><span>{projects.length} {projects.length === 1 ? 'APARTMENT' : 'APARTMENTS'}</span><span>LAST EDITED</span></div>
            <div className="project-grid">
              {projects.map((project, index) => (
                <article className="project-card" key={project.id}>
                  <Link className="project-card-open" href={`/projects/${encodeURIComponent(project.id)}`} aria-label={`Open ${project.name}`} onClick={() => setPendingDelete(null)}>
                    <div className="project-plan-preview" aria-hidden="true"><span className={`plan-variant plan-variant-${index % 3}`}><i /><b /></span><em>{String(index + 1).padStart(2, '0')}</em></div>
                  </Link>
                  <div className="project-card-details">
                    {renamingId === project.id ? (
                      <form className="project-rename-form" onSubmit={(event) => void renameProject(event, project)}>
                        <input autoFocus maxLength={80} aria-label="Project name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(''); }} />
                        <button disabled={busyId === project.id || !renameValue.trim()}>{busyId === project.id ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={() => setRenamingId('')}>Cancel</button>
                      </form>
                    ) : (
                      <><Link href={`/projects/${encodeURIComponent(project.id)}`} onClick={() => setPendingDelete(null)}><strong>{project.name}</strong><span>{updatedLabel(project.updatedAt)}</span></Link><div className="project-card-actions"><button onClick={() => beginRename(project)}>Rename</button><button className="delete" onClick={() => prepareDeleteProject(project)} disabled={busyId === project.id}>{busyId === project.id ? 'Working…' : 'Delete'}</button></div></>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
      {pendingDelete && <DestructiveConfirmationDialog kind="delete" projectName={pendingDelete.projectName} busy={busyId === pendingDelete.projectId} onCancel={() => setPendingDelete(null)} onConfirm={() => void removeProject({ id: pendingDelete.projectId, name: pendingDelete.projectName, revision: pendingDelete.revision, createdAt: '', updatedAt: '' })} />}
    </main>
  );
}
