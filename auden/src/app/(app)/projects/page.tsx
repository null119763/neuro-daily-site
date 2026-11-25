import { Suspense } from "react";
import { ProjectsView } from "@/ui/components/ProjectsView";

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
