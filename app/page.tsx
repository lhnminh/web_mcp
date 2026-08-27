'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type ProjectSummary = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

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

  const loadProjects = async () => {
    setError('');
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      const result = await response.json() as { projects?: ProjectSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Projects could not be loaded.');
      setProjects(result.projects ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Projects could not be loaded.');
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
      .then((result) => { if (!cancelled) setProjects(result); })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const createProject = async () => {
    if (creating || loading) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json() as ProjectSummary & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The apartment could not be created.');
      router.push(`/projects/${encodeURIComponent(result.id)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The apartment could not be created.');
      setCreating(false);
    }
  };

  const beginRename = (project: ProjectSummary) => {
    setRenamingId(project.id);
    setRenameValue(project.name);
    setError('');
  };

  const renameProject = async (event: FormEvent, project: ProjectSummary) => {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || name === project.name || busyId) {
      setRenamingId('');
      return;
    }
    setBusyId(project.id);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, expectedRevision: project.revision }),
      });
      const result = await response.json() as ProjectSummary & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The project could not be renamed.');
      setProjects((current) => current.map((item) => item.id === project.id ? result : item).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setRenamingId('');
    } catch (renameError) {
      await loadProjects();
      setError(renameError instanceof Error ? renameError.message : 'The project could not be renamed.');
    } finally {
      setBusyId('');
    }
  };

  const removeProject = async (project: ProjectSummary) => {
    if (busyId || !window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    setBusyId(project.id);
    setError('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'The project could not be deleted.');
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The project could not be deleted.');
    } finally {
      setBusyId('');
    }
  };

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
                  <Link className="project-card-open" href={`/projects/${encodeURIComponent(project.id)}`} aria-label={`Open ${project.name}`}>
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
                      <><Link href={`/projects/${encodeURIComponent(project.id)}`}><strong>{project.name}</strong><span>{updatedLabel(project.updatedAt)}</span></Link><div className="project-card-actions"><button onClick={() => beginRename(project)}>Rename</button><button className="delete" onClick={() => void removeProject(project)} disabled={busyId === project.id}>{busyId === project.id ? 'Working…' : 'Delete'}</button></div></>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
