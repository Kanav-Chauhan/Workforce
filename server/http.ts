// The HTTP server: hooks and MCP for agents (local only), and the owner's API.
// Behind Caddy, only /api and the dashboard are reachable; /hook and /mcp refuse forwarded requests.

import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { App } from "./app.ts";
import { handleMcp } from "./mcp.ts";
import { readUsage } from "./usage.ts";

const bearer = (req: FastifyRequest) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
/** Agents talk to us from this machine only, never through the proxy. */
const fromAgent = (req: FastifyRequest) => !req.headers["x-forwarded-for"] && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip);

export function buildHttp(app: App) {
  const f = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const { store, work, runner, hooks, projects } = app;
  const db = store.db;

  // Errors from our own rules become a 400 with a readable message.
  f.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ error: err.message });
  });

  // ------------------------------------------------------------ agents

  f.post<{ Params: { event: string } }>("/hook/:event", async (req, reply) => {
    if (!fromAgent(req)) return reply.code(403).send({});
    const r = await hooks.handle(bearer(req), req.params.event, (req.body ?? {}) as Record<string, unknown>);
    return reply.code(r.status).send(r.body ?? {});
  });

  f.all("/mcp", async (req, reply) => {
    if (!fromAgent(req)) return reply.code(403).send({});
    reply.hijack();
    const ok = await handleMcp(store, work, bearer(req), req.raw, reply.raw, req.body);
    if (!ok) {
      reply.raw.writeHead(401, { "content-type": "application/json" });
      reply.raw.end('{"error":"unknown agent"}');
    }
  });

  // ------------------------------------------------------------ owner API

  f.get("/api/health", async () => ({ ok: true }));

  f.get("/api/state", async () => ({
    projects: db.projects(),
    agents: db.agents(),
    tasks: db.projects().flatMap((p) => db.tasks(p.id)),
    needs: db.openNeeds(),
    usage: readUsage(db),
  }));

  f.get<{ Params: { id: string } }>("/api/projects/:id/feed", async (req) => ({
    activity: db.activity(req.params.id),
    messages: db.messages(req.params.id),
  }));

  f.post<{ Body: { repo: string } }>("/api/projects", async (req) => projects.add(String(req.body?.repo ?? "")));

  f.post<{ Params: { id: string }; Body: { sign?: string } }>("/api/projects/:id/agents", async (req) => projects.addAgent(req.params.id, req.body?.sign));

  f.post<{ Params: { id: string; action: string } }>("/api/projects/:id/team/:action", async (req, reply) => {
    const team = db.agents(req.params.id);
    if (!team.length) return reply.code(404).send({ error: "No such project" });
    if (req.params.action === "start") for (const a of team) await runner.start(a.id);
    else if (req.params.action === "stop") for (const a of team) await runner.stop(a.id);
    else return reply.code(404).send({ error: "Use start or stop" });
    return { ok: true };
  });

  f.post<{ Params: { id: string; action: string } }>("/api/agents/:id/:action", async (req, reply) => {
    const { id, action } = req.params;
    if (!db.agent(id)) return reply.code(404).send({ error: "No such agent" });
    const actions: Record<string, (id: string) => Promise<void>> = { start: (x) => runner.start(x), stop: (x) => runner.stop(x), restart: (x) => runner.restart(x), fresh: (x) => runner.fresh(x) };
    const fn = actions[action];
    if (!fn) return reply.code(404).send({ error: "Use start, stop, restart or fresh" });
    await fn(id);
    return db.agent(id);
  });

  f.get<{ Params: { id: string }; Querystring: { lines?: string } }>("/api/agents/:id/screen", async (req) => ({
    screen: await runner.screen(req.params.id, Number(req.query.lines ?? 60)),
  }));

  f.post<{ Params: { id: string }; Body: { to?: string; text: string } }>("/api/projects/:id/message", async (req) =>
    work.message(req.params.id, "owner", req.body?.to || "lead", String(req.body?.text ?? "")),
  );

  f.post<{ Params: { id: string }; Body: { title: string; details?: string; files?: string[]; doneWhen?: string } }>("/api/projects/:id/tasks", async (req) =>
    work.createTask(req.params.id, req.body, "owner"),
  );

  f.post<{ Params: { id: string }; Body: { to: string } }>("/api/tasks/:id/assign", async (req, reply) => {
    const t = db.task(req.params.id);
    if (!t) return reply.code(404).send({ error: "No such task" });
    return work.assign(t.projectId, t.id, String(req.body?.to ?? ""), "owner");
  });

  f.post<{ Params: { id: string }; Body: { allow: boolean; note?: string } }>("/api/needs/:id/decide", async (req) =>
    hooks.decide(Number(req.params.id), !!req.body?.allow, String(req.body?.note ?? "")),
  );

  f.post<{ Params: { id: string }; Body: { answer?: string } }>("/api/needs/:id/answer", async (req) => work.answer(Number(req.params.id), String(req.body?.answer ?? "")));

  f.post<{ Body: { paused?: boolean; limit?: number } }>("/api/usage", async (req) => {
    if (typeof req.body?.paused === "boolean") db.setSetting("paused", req.body.paused ? "1" : "0");
    if (typeof req.body?.limit === "number" && req.body.limit > 0 && req.body.limit <= 100) db.setSetting("usage_limit", String(Math.round(req.body.limit)));
    return readUsage(db);
  });

  return f;
}

export type Reply = FastifyReply;
