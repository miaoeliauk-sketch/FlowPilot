import path from "node:path";
import { createLocalSyncRouteHandlers } from "@/lib/local-sync-route-handlers";
import { LocalSyncManager } from "@/lib/local-sync-manager";

export const runtime = "nodejs";

const routeHandlers = createLocalSyncRouteHandlers({
  manager: new LocalSyncManager({
    dataDir: path.join(process.cwd(), "data"),
  }),
});

export const GET = routeHandlers.GET;
export const POST = routeHandlers.POST;
