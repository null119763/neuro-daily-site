import { ProjectDetailView } from "@/ui/components/ProjectsView";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetailView key={id} id={id} />;
}
