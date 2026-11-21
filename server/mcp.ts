// The team tools agents use, served at /mcp (Streamable HTTP, stateless).
// The bearer token tells us which agent is calling; every tool runs as that agent.

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Agent } from "../shared/types.ts";
import { MCP_NAME } from "./agentFiles.ts";
import type { Store } from "./store.ts";
import type { Work } from "./work.ts";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (v: unknown): Result => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

/** Runs a tool body; a thrown error becomes a readable tool error instead of a crash. */
const safe =
  <A>(fn: (args: A) => unknown) =>
  async (args: A): Promise<Result> => {
    try {
      return text(await fn(args));
    } catch (err) {
      return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  };

function server(store: Store, work: Work, me: Agent): McpServer {
  const s = new McpServer({ name: MCP_NAME, version: "0.1.0" });
  const db = store.db;
  const leadOnly = () => {
    if (!me.isLead) throw new Error("Only the lead can do that. Ask the lead with the message tool.");
  };
  const taskView = (t: ReturnType<typeof db.tasks>[number]) => ({
    id: t.id, title: t.title, status: t.status, owner: t.ownerId ? store.nameOf(t.ownerId) : null, phase: t.phase || undefined,
    dependsOn: t.dependsOn.length ? t.dependsOn : undefined, pr: t.prNumber ?? undefined,
  });

  s.registerTool("team", { description: "Everyone on the team: name, role, status and current task." }, safe(() =>
    db.agents(me.projectId).map((a) => ({ name: a.name, role: a.isLead ? "lead" : "developer", status: a.state, doing: a.note, task: a.taskId, you: a.id === me.id || undefined })),
  ));

  s.registerTool(
    "tasks",
    {
      description: "List the project's tasks. Optional filters: status (todo, working, review, blocked, done), owner (a name), phase.",
      inputSchema: { status: z.string().optional(), owner: z.string().optional(), phase: z.string().optional() },
    },
    safe(({ status, owner, phase }: { status?: string; owner?: string; phase?: string }) => {
      const ownerId = owner ? work.findAgent(me.projectId, owner)?.id ?? "-" : null;
      return db
        .tasks(me.projectId)
        .filter((t) => (!status || t.status === status) && (!ownerId || t.ownerId === ownerId) && (!phase || t.phase.toLowerCase() === phase.toLowerCase()))
        .map(taskView);
    }),
  );

  s.registerTool(
    "create_task",
    {
      description: "Lead only. Add a task: one task = one branch = one PR. Give the files it may edit and a 'done when' the owner can check.",
      inputSchema: {
        title: z.string(),
        details: z.string().optional().describe("What to build and why, and the steps"),
        files: z.array(z.string()).optional().describe("The only files or folders this task may edit"),
        doneWhen: z.string().optional().describe("Checks the owner can run or click"),
        dependsOn: z.array(z.string()).optional().describe("Task ids that must be finished first"),
        phase: z.string().optional(),
      },
    },
    safe((a: { title: string; details?: string; files?: string[]; doneWhen?: string; dependsOn?: string[]; phase?: string }) => {
      leadOnly();
      return taskView(work.createTask(me.projectId, a, me.id));
    }),
  );

  s.registerTool(
    "edit_task",
    {
      description: "Lead only. Change a task's details or status.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        details: z.string().optional(),
        files: z.array(z.string()).optional(),
        doneWhen: z.string().optional(),
        dependsOn: z.array(z.string()).optional(),
        phase: z.string().optional(),
        status: z.enum(["todo", "working", "review", "blocked", "done"]).optional(),
      },
    },
    safe(({ id, ...patch }: { id: string; title?: string; details?: string; files?: string[]; doneWhen?: string; dependsOn?: string[]; phase?: string; status?: "todo" | "working" | "review" | "blocked" | "done" }) => {
      leadOnly();
      return taskView(work.editTask(me.projectId, id, patch));
    }),
  );

  s.registerTool(
    "assign",
    {
      description: "Lead only. Give a task to a developer. Workforce tells them to start (right away if they're free, otherwise when their current step ends).",
      inputSchema: { taskId: z.string(), to: z.string().describe("The developer's name") },
    },
    safe(({ taskId, to }: { taskId: string; to: string }) => {
      leadOnly();
      return taskView(work.assign(me.projectId, taskId, to, me.id));
    }),
  );

  s.registerTool("my_task", { description: "Your current task in full: details, the files you may edit, done-when and dependencies. Marks it as working." }, safe(() => {
    const t = work.myTask(me.id);
    if (!t) return "You have no task right now. Wait for the lead, or ask them with the message tool.";
    return { id: t.id, title: t.title, details: t.details, files: t.files, doneWhen: t.doneWhen, dependsOn: t.dependsOn, phase: t.phase, branchHint: t.id.toLowerCase() };
  }));

  s.registerTool(
    "report",
    {
      description: "Update your current task: working, blocked (say why), review (you opened the PR: give its number) or done. The lead is told automatically.",
      inputSchema: { status: z.enum(["working", "blocked", "review", "done"]), note: z.string().optional(), pr: z.number().int().positive().optional() },
    },
    safe(({ status, note, pr }: { status: "working" | "blocked" | "review" | "done"; note?: string; pr?: number }) => {
      if (status === "review" && !pr) throw new Error("Give the PR number with status review.");
      return taskView(work.report(me.id, status, note ?? "", pr));
    }),
  );

  s.registerTool(
    "message",
    {
      description: 'Send a message to a teammate (their name, or "lead"). Delivered right away if they are free, otherwise when their current step ends.',
      inputSchema: { to: z.string(), text: z.string() },
    },
    safe(({ to, text: body }: { to: string; text: string }) => {
      const m = work.message(me.projectId, me.id, to, body);
      return `Sent to ${store.nameOf(m.toId)}.`;
    }),
  );

  s.registerTool(
    "ask_owner",
    {
      description:
        "Ask the owner (the human) for something only they can do or decide: create an account or database, add a key, change a dashboard setting, or make a product decision. Give short, clear steps. Never include secret values. Their answer comes back as a message; keep working on what you can meanwhile.",
      inputSchema: { title: z.string().describe("What you need, in a few words"), details: z.string().describe("Exact steps or the options to choose from") },
    },
    safe(({ title, details }: { title: string; details: string }) => {
      const n = work.askOwner(me.id, title, details);
      return `Added to the owner's list (#${n.id}). You'll get their answer as a message.`;
    }),
  );

  return s;
}

/** Handles one MCP HTTP request. Returns false if the token is unknown. */
export async function handleMcp(store: Store, work: Work, token: string, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<boolean> {
  const me = store.db.agentByToken(token);
  if (!me) return false;
  const s = server(store, work, me);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void s.close();
  });
  await s.connect(transport);
  await transport.handleRequest(req, res, body);
  return true;
}
