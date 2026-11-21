import { describe, expect, it } from "vitest";
import type { LiveFrame } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { Db, now } from "./db.ts";
import { buildHttp } from "./http.ts";

function setup() {
  const db = new Db(":memory:");
  const app = createApp(db);
  db.addProject({ id: "demo", repo: "me/demo", name: "demo", prefix: "DM", defaultBranch: "main", permissionStyle: "careful", createdAt: now() });
  for (const sign of ["simha", "mesha"]) app.projects.addAgent("demo", sign);
  const http = buildHttp(app);
  return { app, http };
}

function frames(ws: { on(ev: "message", fn: (d: Buffer) => void): void }) {
  const got: LiveFrame[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    got.push(JSON.parse(String(d)) as LiveFrame);
    waiters.splice(0).forEach((f) => f());
  });
  const next = async (n: number) => {
    while (got.length < n) await new Promise<void>((r) => waiters.push(r));
    return got;
  };
  return next;
}

describe("/live", () => {
  it("sends the state first, then every store event", async () => {
    const { app, http } = setup();
    await http.ready();
    let next!: ReturnType<typeof frames>;
    const ws = await http.injectWS("/live", {}, { onInit: (w) => (next = frames(w)) });
    const [init] = await next(1);
    expect(init?.type).toBe("init");
    if (init?.type === "init") expect(init.state.agents.map((a) => a.name)).toEqual(["Simha", "Mesha"]);
    app.work.message("demo", "owner", "lead", "Add a footer");
    const got = await next(3); // message + activity
    expect(got.slice(1).map((f) => f.type).sort()).toEqual(["activity", "message"]);
    ws.terminate();
    await http.close();
  });

  it("refuses a page from another site", async () => {
    const { http } = setup();
    await http.ready();
    const ws = await http.injectWS("/live", { headers: { origin: "https://evil.example", host: "127.0.0.1:3010" } });
    const code = await new Promise<number>((r) => ws.on("close", (c: number) => r(c)));
    expect(code).toBe(1008);
    await http.close();
  });

  it("types into an agent only when it runs", async () => {
    const { http } = setup();
    const r = await http.inject({ method: "POST", url: "/api/agents/demo.mesha/type", payload: { text: "hi", enter: true } });
    expect(r.statusCode).toBe(409);
    const bad = await http.inject({ method: "POST", url: "/api/agents/nope/type", payload: { text: "hi" } });
    expect(bad.statusCode).toBe(404);
    await http.close();
  });
});
