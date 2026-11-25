import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSession } from "@/server/next-session";
import { getRuntime } from "@/server/runtime";
import { LoginForm } from "@/ui/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getServerSession()) redirect("/");
  const c = await cookies();
  const rt = getRuntime();
  return <LoginForm locale={c.get("auden_locale")?.value === "en" ? "en" : "ru"} backend={rt.backend.kind} signupsOpen={rt.config.signupsOpen} />;
}
