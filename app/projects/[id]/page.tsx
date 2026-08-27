import ProjectEditor from '@/app/ProjectEditor';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectEditor key={id} projectId={id} />;
}
