import { handleApi } from "@/server/api";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) => handleApi(req, getRuntime());
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE, handler as PUT };
