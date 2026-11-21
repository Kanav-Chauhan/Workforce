import { DEFAULT_WORKFLOW } from "../shared/types.ts";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { boardOf, boardsOf } from "../shared/boards.ts";
import { stackPlan } from "../shared/stacks.ts";
import type { Project } from "../shared/types.ts";
import { mcpJson, permissions, roleText } from "./agentFiles.ts";
import { Courier } from "./courier.ts";
import { Db, now } from "./db.ts";
import { checkEnvName, formatEnv, parseEnv, readEnv, setEnv, unsetEnv } from "./env.ts";
import { envFile } from "./paths.ts";
import { planMarkdown } from "./planExport.ts";
import { descendants, parseSs, portsOf } from "./ports.ts";
import { Projects } from "./projects.ts";
import { diskLine, versionIn } from "./setup.ts";
import { withExclude } from "./stack.ts";
import { Store } from "./store.ts";
import { Work } from "./work.ts";

beforeAll(() => {
  process.env.WORKFORCE_HOME = mkdtempSync(join(tmpdir(), "wf-2b-"));
});

function setup() {
  const db = new Db(":memory:");
  const store = new Store(db);
  const courier = new Courier(store, { put: async () => true, submit: async () => true });
  const work = new Work(store, courier);
  const projects = new Projects(store);
  const project: Project = { id: "demo", repo: "me/demo", name: "demo", prefix: "DM", defaultBranch: "main", permissionStyle: "careful", createdAt: now(), stack: [], boards: ["Main"], planExport: false, workflow: { ...DEFAULT_WORKFLOW } };
  db.addProject(project);
  for (const sign of ["leo", "aries"]) projects.addAgent("demo", sign);
  return { db, store, work, projects, project };
}

describe("env files", () => {
  it("round-trips values with quotes and newlines", () => {
    const vars = { A: "plain", B: "it's \"quoted\" $HOME", C: "two\nlines" };
    expect(parseEnv(formatEnv(vars))).toEqual(vars);
  });
  it("refuses bad and system names", () => {
    expect(() => checkEnvName("1ABC")).toThrow();
    expect(() => checkEnvName("PATH")).toThrow();
    expect(() => checkEnvName("CLAUDE_X")).toThrow();
    expect(checkEnvName(" STRIPE_KEY ")).toBe("STRIPE_KEY");
  });
  it("stores per agent with owner-only permissions", () => {
    setEnv("p.leo", "TOKEN", "s3cret");
    expect(readEnv("p.leo")).toEqual({ TOKEN: "s3cret" });
    expect(statSync(envFile("p.leo")).mode & 0o777).toBe(0o600);
    unsetEnv("p.leo", "TOKEN");
    expect(readFileSync(envFile("p.leo"), "utf8")).toBe("");
  });
});

describe("stack", () => {
  it("collects skills once and docs domains", () => {
    const plan = stackPlan(["nextjs", "react", "tailwind", "nope"]);
    expect(plan.skills.map((s) => s.name)).toEqual(["react-best-practices", "composition-patterns"]);
    expect(plan.domains).toEqual(["nextjs.org", "react.dev", "tailwindcss.com", "vercel.com"]);
  });
  it("adds the git exclude line once", () => {
    const once = withExclude("# git ls-files\n*.log");
    expect(once).toBe("# git ls-files\n*.log\n/.claude/workforce-stack/\n");
    expect(withExclude(once)).toBe(once);
  });
  it("lets agents fetch the stack's docs without asking", () => {
    const { db, project } = setup();
    const team = db.agents("demo");
    const p = permissions("careful", { ...project, stack: ["stripe"] }, team[1]!, team);
    expect(p.allow).toContain("WebFetch(domain:docs.stripe.com)");
    expect(p.deny.some((d) => d.includes("/env/**"))).toBe(true);
  });
});

describe("mcp servers", () => {
  it("writes header values as env references, never values", () => {
    const j = mcpJson("tok", [
      { id: 1, name: "sentry", kind: "http", command: "", args: [], url: "https://mcp.sentry.dev/mcp", headerName: "Authorization", envName: "SENTRY_TOKEN", agentIds: [] },
      { id: 2, name: "files", kind: "stdio", command: "npx", args: ["-y", "some-server"], url: "", headerName: "", envName: "", agentIds: [] },
    ]);
    expect(j.mcpServers.sentry).toEqual({ type: "http", url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "${SENTRY_TOKEN}" } });
    expect(j.mcpServers.files).toEqual({ type: "stdio", command: "npx", args: ["-y", "some-server"] });
    expect(Object.keys(j.mcpServers)).toContain("workforce");
  });
  it("tells the agent env names and tools, not values", () => {
    const { db, project } = setup();
    const team = db.agents("demo");
    const role = roleText(team[1]!, project, team, { envNames: ["API_KEY"], mcp: [] });
    expect(role).toContain("`API_KEY`");
  });
});

describe("boards", () => {
  it("lists project boards plus boards tasks name, first board is the default", () => {
    const boards = boardsOf({ boards: ["v1"] }, [{ phase: "" }, { phase: "Polish" }, { phase: "V1" }]);
    expect(boards).toEqual(["v1", "Polish"]);
    expect(boardOf({ phase: "" }, boards)).toBe("v1");
    expect(boardOf({ phase: "polish" }, boards)).toBe("Polish");
  });
  it("creates a board when a task names a new one, removes only empty ones", () => {
    const { db, work } = setup();
    const t = work.createTask("demo", { title: "Logo", board: "Polish" }, "owner");
    expect(t.phase).toBe("Polish");
    expect(db.project("demo")!.boards).toEqual(["Main", "Polish"]);
    expect(() => work.removeBoard("demo", "polish")).toThrow();
    work.addBoard("demo", "Later");
    work.removeBoard("demo", "later");
    expect(db.project("demo")!.boards).toEqual(["Main", "Polish"]);
  });
});

describe("ports", () => {
  const ss = [
    'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=210,fd=21))',
    'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=210,fd=22))',
    'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*',
    'LISTEN 0 511 *:5173 *:* users:(("vite",pid=999,fd=3))',
  ].join("\n");
  it("reads ss output", () => {
    const l = parseSs(ss);
    expect(l.map((x) => x.port)).toEqual([3000, 3000, 22, 5173]);
    expect(l[1]!.address).toBe("::");
    expect(l[0]!.pids).toEqual([{ program: "node", pid: 210 }]);
  });
  it("matches ports to the agent whose process tree owns them", () => {
    const ps = "100 1\n150 100\n210 150\n999 5\n";
    const tree = descendants(ps, [100]);
    expect([...tree].sort()).toEqual([100, 150, 210]);
    const ports = portsOf(parseSs(ss), new Map([["a", tree]]));
    expect(ports).toEqual([{ agentId: "a", port: 3000, address: "127.0.0.1", program: "node", pid: 210 }]);
  });
});

describe("setup + plan export", () => {
  it("reads versions and disk space", () => {
    expect(versionIn("git version 2.43.0")).toBe("2.43.0");
    expect(versionIn("tmux 3.6")).toBe("3.6");
    expect(diskLine(50 * 1024 **3)).toEqual({ ok: true, detail: "50 GB free" });
    expect(diskLine(1024 ** 3).ok).toBe(false);
  });
  it("writes the plan as markdown per board", () => {
    const { db, work, project } = setup();
    work.createTask("demo", { title: "Health page", doneWhen: "GET /health is ok" }, "owner");
    const t2 = work.createTask("demo", { title: "Footer", board: "Polish" }, "owner");
    work.assign("demo", t2.id, "aries", "owner");
    const md = planMarkdown({ ...project, boards: db.project("demo")!.boards }, db.tasks("demo"), db.agents("demo"));
    expect(md).toContain("## Main");
    expect(md).toContain("- [ ] **DM-1** Health page");
    expect(md).toContain("  - Done when: GET /health is ok");
    expect(md).toContain("## Polish");
    expect(md).toContain("**DM-2** Footer (Aries)");
  });
});

describe("team changes", () => {
  it("adds a custom agent with its own role and colour", () => {
    const { projects, db } = setup();
    const a = projects.addCustom("demo", { name: "Quinn", role: "QA", color: "#336699" });
    expect(a.sign).toBe("x-quinn");
    expect(db.agent(a.id)).toMatchObject({ name: "Quinn", role: "QA", color: "#336699", isLead: false, folder: "" });
    expect(() => projects.addCustom("demo", { name: "quinn", role: "QA" })).toThrow();
    expect(() => projects.addCustom("demo", { name: "Dee", role: "Designer", folder: "/definitely/not/here" })).toThrow();
    expect(() => projects.addCustom("demo", { name: "Dee", role: "Designer", folder: "relative/path" })).toThrow();
  });
  it("removing an agent frees its tasks and MCP servers", () => {
    const { db, work } = setup();
    const t = work.createTask("demo", { title: "x" }, "owner");
    work.assign("demo", t.id, "aries", "owner");
    work.myTask("demo.aries");
    db.saveMcpServer({ id: 0, name: "x", kind: "stdio", command: "npx", args: [], url: "", headerName: "", envName: "", agentIds: ["demo.aries", "demo.leo"] });
    db.removeAgent("demo.aries");
    expect(db.task(t.id)).toMatchObject({ ownerId: null, status: "todo" });
    expect(db.mcpServers()[0]!.agentIds).toEqual(["demo.leo"]);
  });
  it("starts a project with the chosen team size", async () => {
    // add() needs GitHub; check the worker picking through addAgent order instead
    const { projects, db } = setup();
    projects.addAgent("demo");
    expect(db.agents("demo").map((a) => a.sign)).toEqual(["leo", "aries", "virgo"]);
  });
});
