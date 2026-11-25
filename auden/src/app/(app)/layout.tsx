import { redirect } from "next/navigation";
import { getServerAdmin, getServerSession } from "@/server/next-session";
import { getRuntime } from "@/server/runtime";
import { AppProvider } from "@/ui/app-context";
import { AppShell } from "@/ui/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const [profile, isAdmin] = await Promise.all([session.store.getProfile(), getServerAdmin(session)]);
  return (
    <AppProvider user={session.user} profile={profile} backend={getRuntime().backend.kind} isAdmin={isAdmin}>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
