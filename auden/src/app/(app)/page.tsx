import { HomeView } from "@/ui/components/HomeView";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return <HomeView projectId={project ?? null} />;
}
