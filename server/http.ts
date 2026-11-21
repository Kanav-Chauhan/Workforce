// The HTTP server: hooks and MCP for agents (local only), and the owner's API.
// Behind Caddy, only /api and the dashboard are reachable; /hook and /mcp refuse forwarded requests.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { App } from "./app.ts";
import { registerLive } from "./live.ts";
import { STACK } from "../shared/stacks.ts";
import type { McpServer, PermissionStyle } from "../shared/types.ts";
import { MCP_NAME } from "./agentFiles.ts";
import { checkEnvName, envNames, setEnv, unsetEnv } from "./env.ts";
import { planFile } from "./planExport.ts";
import { openPorts } from "./ports.ts";
import { runChecks } from "./setup.ts";
import { applyStack, type StackReport } from "./stack.ts";
import { roomName, registerTerminals, TermRooms, type SpawnPty } from "./terminals.ts";
import { handleMcp } from "./mcp.ts";
import { sessionName } from "./runner.ts";
import { tmux } from "./tmux.ts";
import { readUsage } from "./usage.ts";

const bearer = (req: FastifyRequest) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
/** Agents talk to us from this machine only, never through the proxy. */
/** Keys the dashboard may press in an agent's terminal, besides typed text. */
const KEYS = new Set(["Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "BSpace", "C-c"]);

/** The built dashboard (Next.js static export). Override with WORKFORCE_WEB. */
const webDir = () => process.env.WORKFORCE_WEB || join(dirname(fileURLToPath(import.meta.url)), "..", "web", "out");

const fromAgent = (req: FastifyRequest) => !req.headers["x-forwarded-for"] && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip);

export function buildHttp(app: App, pty: { spawn: SpawnPty | null; reason: string } = { spawn: null, reason: "not loaded" }) {
  const f = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const { store, work, runner, hooks, projects } = app;
  const db = store.db;

  f.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  f.register(async (scope) => registerLive(scope, app));
  const rooms = pty.spawn ? new TermRooms(pty.spawn) : null;
  f.register(async (scope) => registerTerminals(scope, app, rooms, pty.reason));

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

  f.post<{ Body: { repo: string; workers?: number; permissionStyle?: PermissionStyle } }>("/api/projects", async (req) =>
    projects.add(String(req.body?.repo ?? ""), { workers: Number(req.body?.workers) || undefined, permissionStyle: req.body?.permissionStyle }),
  );

  const mustProject = (id: string) => {
    const p = db.project(id);
    if (!p) throw Object.assign(new Error("No such project"), { statusCode: 404 });
    return p;
  };

  // Project settings: permission style and plan export.
  f.patch<{ Params: { id: string }; Body: { permissionStyle?: string; planExport?: boolean } }>("/api/projects/:id", async (req) => {
    mustProject(req.params.id);
    const b = req.body ?? {};
    if (b.permissionStyle !== undefined && b.permissionStyle !== "careful" && b.permissionStyle !== "trusted") throw new Error("Use careful or trusted");
    db.updateProject(req.params.id, { permissionStyle: b.permissionStyle as PermissionStyle | undefined, planExport: typeof b.planExport === "boolean" ? b.planExport : undefined });
    const project = db.project(req.params.id)!;
    store.emit({ type: "project", project });
    return project;
  });

  f.get<{ Params: { id: string } }>("/api/projects/:id/plan-export", async (req) => {
    const project = mustProject(req.params.id);
    const lead = db.agents(project.id).find((a) => a.isLead);
    const written = project.planExport ? app.planExport.write(project.id) : null;
    return { on: project.planExport, path: lead ? planFile(lead) : null, written: !!written };
  });

  f.post<{ Params: { id: string }; Body: { name: string } }>("/api/projects/:id/boards", async (req) => ({ name: work.addBoard(req.params.id, String(req.body?.name ?? "")) }));
  f.delete<{ Params: { id: string; name: string } }>("/api/projects/:id/boards/:name", async (req) => (work.removeBoard(req.params.id, req.params.name), { ok: true }));

  f.post<{ Params: { id: string }; Body: { sign?: string; custom?: { name: string; role: string; color?: string; model?: string; folder?: string } } }>("/api/projects/:id/agents", async (req) =>
    req.body?.custom ? projects.addCustom(req.params.id, req.body.custom) : projects.addAgent(req.params.id, req.body?.sign),
  );

  f.delete<{ Params: { id: string }; Querystring: { deleteFolder?: string } }>("/api/agents/:id", async (req, reply) => {
    const a = db.agent(req.params.id);
    if (!a) return reply.code(404).send({ error: "No such agent" });
    for (const kind of ["agent", "shell"] as const) rooms?.dispose(roomName(kind, a.id));
    await runner.remove(a.id, req.query.deleteFolder === "1");
    return { ok: true };
  });

  // ------------------------------------------------------------ office, setup, debug

  f.post<{ Body: { name: string } }>("/api/office", async (req) => {
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    db.setSetting("office_name", name);
    store.emit({ type: "office", office: { name } });
    return { name };
  });

  f.get("/api/setup", async () => ({ checks: await runChecks(), platform: process.platform, terminals: !!rooms }));

  f.get("/api/debug", async () => {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version: string };
    return {
      version: pkg.version,
      node: process.versions.node,
      uptimeS: Math.round((Date.now() - app.startedAt) / 1000),
      pid: process.pid,
      tmuxSessions: await tmux.list(),
      liveTerminals: !!rooms,
      lastHooks: db.agents().map((a) => ({ agentId: a.id, name: a.name, projectId: a.projectId, ...(hooks.lastHook.get(a.id) ?? { event: null, at: null }) })),
    };
  });

  // ------------------------------------------------------------ stack picker

  const reportKey = (id: string) => `stack_report:${id}`;
  f.get<{ Params: { id: string } }>("/api/projects/:id/stack", async (req) => {
    const project = mustProject(req.params.id);
    const saved = db.setting(reportKey(project.id));
    return { stack: project.stack, report: saved ? (JSON.parse(saved) as StackReport) : null };
  });

  f.post<{ Params: { id: string }; Body: { tools: string[] } }>("/api/projects/:id/stack", async (req) => {
    mustProject(req.params.id);
    const tools = [...new Set((req.body?.tools ?? []).map(String))].filter((t) => STACK.some((x) => x.id === t));
    db.updateProject(req.params.id, { stack: tools });
    const project = db.project(req.params.id)!;
    store.emit({ type: "project", project });
    const report = await applyStack(project, db.agents(project.id));
    db.setSetting(reportKey(project.id), JSON.stringify(report));
    store.activity(project.id, null, `Stack set: ${tools.map((t) => STACK.find((x) => x.id === t)!.label).join(", ") || "nothing"}`);
    return { stack: tools, report };
  });

  // ------------------------------------------------------------ MCP servers

  f.get("/api/mcp", async () => ({ servers: db.mcpServers() }));

  f.post<{ Body: Partial<McpServer> }>("/api/mcp", async (req) => {
    const b = req.body ?? {};
    const name = String(b.name ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) throw new Error("Name: letters, digits, - and _ only");
    if (name.toLowerCase() === MCP_NAME) throw new Error(`"${MCP_NAME}" is the team tools' name`);
    const kind = b.kind === "http" ? "http" : "stdio";
    const server: McpServer = {
      id: Number(b.id) || 0, name, kind, command: "", args: [], url: "", headerName: "", envName: "",
      agentIds: (b.agentIds ?? []).map(String).filter((id) => db.agent(id)),
    };
    if (kind === "stdio") {
      server.command = String(b.command ?? "").trim();
      if (!server.command) throw new Error("Give the command to run, like npx");
      server.args = (b.args ?? []).map(String).filter(Boolean).slice(0, 30);
    } else {
      server.url = String(b.url ?? "").trim();
      if (!/^https?:\/\/\S+$/.test(server.url)) throw new Error("Give the server's URL (http or https)");
      server.headerName = String(b.headerName ?? "").trim();
      server.envName = String(b.envName ?? "").trim();
      if (server.headerName && !/^[A-Za-z0-9-]{1,60}$/.test(server.headerName)) throw new Error("Header name: letters, digits and - only");
      if (server.headerName) server.envName = checkEnvName(server.envName);
      else server.envName = "";
    }
    if (db.mcpServers().some((m) => m.name.toLowerCase() === name.toLowerCase() && m.id !== server.id)) throw new Error(`There is already a server called ${name}`);
    return db.saveMcpServer(server);
  });

  f.delete<{ Params: { id: string } }>("/api/mcp/:id", async (req) => (db.removeMcpServer(Number(req.params.id)), { ok: true }));

  // ------------------------------------------------------------ environment (names only, ever)

  const envView = (agentId: string) => {
    const set = envNames(agentId);
    const wanted = db.mcpServers().filter((m) => m.agentIds.includes(agentId) && m.envName).map((m) => m.envName);
    const names = [...new Set([...set, ...wanted])].sort();
    return { vars: names.map((name) => ({ name, set: set.includes(name), neededBy: db.mcpServers().filter((m) => m.envName === name && m.agentIds.includes(agentId)).map((m) => m.name) })) };
  };
  const mustAgent = (id: string) => {
    if (!db.agent(id)) throw Object.assign(new Error("No such agent"), { statusCode: 404 });
    return id;
  };
  f.get<{ Params: { id: string } }>("/api/agents/:id/env", async (req) => envView(mustAgent(req.params.id)));
  f.post<{ Params: { id: string }; Body: { name: string; value: string } }>("/api/agents/:id/env", async (req) => {
    setEnv(mustAgent(req.params.id), String(req.body?.name ?? ""), String(req.body?.value ?? ""));
    return envView(req.params.id);
  });
  f.delete<{ Params: { id: string; name: string } }>("/api/agents/:id/env/:name", async (req) => {
    unsetEnv(mustAgent(req.params.id), req.params.name);
    return envView(req.params.id);
  });

  // ------------------------------------------------------------ ports

  f.get<{ Params: { id: string } }>("/api/projects/:id/ports", async (req) => {
    mustProject(req.params.id);
    const team = db.agents(req.params.id).filter((a) => a.state !== "off");
    const ports = await openPorts(team, sessionName, (agentId) => [rooms?.pidOf(roomName("shell", agentId)) ?? 0].filter(Boolean));
    // Behind a proxy (the VPS), localhost links would point at the viewer's own machine.
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
    const local = !req.headers["x-forwarded-for"] && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    return { ports, local };
  });

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

  // Type into an agent's terminal (the agent panel's input box). Text is typed literally; `key` presses one key.
  f.post<{ Params: { id: string }; Body: { text?: string; key?: string; enter?: boolean } }>("/api/agents/:id/type", async (req, reply) => {
    const a = db.agent(req.params.id);
    if (!a) return reply.code(404).send({ error: "No such agent" });
    const name = sessionName(a);
    if (!(await tmux.exists(name))) return reply.code(409).send({ error: `${a.name} is not running` });
    const text = String(req.body?.text ?? "").replace(/\r?\n/g, " ").slice(0, 4000);
    const key = req.body?.key;
    if (key !== undefined && !KEYS.has(key)) return reply.code(400).send({ error: "Unknown key" });
    if (text) await tmux.type(name, text);
    if (key) await tmux.key(name, key);
    if (req.body?.enter) {
      if (text) await new Promise((r) => setTimeout(r, 150));
      await tmux.key(name, "Enter");
    }
    return { ok: true };
  });

  f.post<{ Params: { id: string }; Body: { to?: string; text: string } }>("/api/projects/:id/message", async (req) =>
    work.message(req.params.id, "owner", req.body?.to || "lead", String(req.body?.text ?? "")),
  );

  f.post<{ Params: { id: string }; Body: { title: string; details?: string; files?: string[]; doneWhen?: string } }>("/api/projects/:id/tasks", async (req) =>
    work.createTask(req.params.id, req.body, "owner"),
  );

  f.post<{ Params: { id: string }; Body: { to: string; note?: string } }>("/api/tasks/:id/assign", async (req, reply) => {
    const t = db.task(req.params.id);
    if (!t) return reply.code(404).send({ error: "No such task" });
    return work.assign(t.projectId, t.id, String(req.body?.to ?? ""), "owner", String(req.body?.note ?? ""));
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

  // ------------------------------------------------------------ dashboard

  const web = webDir();
  if (existsSync(join(web, "index.html"))) {
    f.register(fastifyStatic, { root: web, prefix: "/", wildcard: true, index: "index.html", redirect: true });
    f.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/live") && !req.url.startsWith("/term/")) return reply.code(404).type("text/html").sendFile("404.html");
      return reply.code(404).send({ error: "Not found" });
    });
  } else {
    f.get("/", async (_req, reply) => reply.type("text/plain").send("Workforce is running. The dashboard is not built yet: npm run build:web"));
  }

  return f;
}

export type Reply = FastifyReply;
