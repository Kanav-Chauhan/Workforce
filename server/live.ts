// The /live WebSocket: the dashboard gets the whole state once, then every change as it happens.
// No login yet (Phase 4), but a page from another site may not connect: the Origin must match the Host.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LiveState } from "../shared/types.ts";
import type { App } from "./app.ts";
import { readUsage } from "./usage.ts";

export function liveState(app: App): LiveState {
  const db = app.store.db;
  const projects = db.projects();
  return {
    projects,
    agents: db.agents(),
    tasks: projects.flatMap((p) => db.tasks(p.id)),
    needs: db.openNeeds(),
    usage: readUsage(db),
    // Oldest first, like the events that follow.
    activity: projects.flatMap((p) => db.activity(p.id, 60).reverse()),
    messages: projects.flatMap((p) => db.messages(p.id, 60).reverse()),
    office: { name: db.setting("office_name") ?? "" },
  };
}

/** Same-site check: a browser always sends Origin on a WebSocket upgrade. */
export function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser (curl, tests)
  try {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function registerLive(f: FastifyInstance, app: App) {
  f.get("/live", { websocket: true }, (socket, req) => {
    if (!sameOrigin(req)) {
      socket.close(1008, "Wrong origin");
      return;
    }
    const send = (data: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    };
    send({ type: "init", state: liveState(app) });
    const off = app.store.on((e) => send(e));
    // Usage changes come from a file, not the store: refresh it every 30 s.
    const usageTimer = setInterval(() => send({ type: "usage", usage: readUsage(app.store.db) }), 30_000);
    // Keep idle proxies from closing the connection.
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on("close", () => {
      off();
      clearInterval(usageTimer);
      clearInterval(ping);
    });
    socket.on("error", () => socket.terminate());
  });
}
