// Wires the parts together. Kept separate from main.ts so tests can build an app without listening.

import { Db } from "./db.ts";
import { Courier } from "./courier.ts";
import { Hooks } from "./hooks.ts";
import { Projects } from "./projects.ts";
import { Runner, sessionName } from "./runner.ts";
import { Store } from "./store.ts";
import { tmux } from "./tmux.ts";
import { readUsage } from "./usage.ts";
import { Work } from "./work.ts";

export interface App {
  store: Store;
  courier: Courier;
  work: Work;
  hooks: Hooks;
  runner: Runner;
  projects: Projects;
}

export function createApp(db = new Db()): App {
  const store = new Store(db);
  const sessionOf = (agentId: string) => {
    const a = db.agent(agentId);
    return a ? sessionName(a) : null;
  };
  const courier = new Courier(store, {
    put: async (agentId, text) => {
      const s = sessionOf(agentId);
      return !!s && tmux.type(s, text);
    },
    submit: async (agentId) => {
      const s = sessionOf(agentId);
      return !!s && tmux.key(s, "Enter");
    },
  });
  let usageAt = 0;
  let usagePaused = false;
  courier.holdTeammates = () => {
    if (Date.now() - usageAt > 30_000) {
      usagePaused = readUsage(db).paused;
      usageAt = Date.now();
    }
    return usagePaused;
  };
  const work = new Work(store, courier);
  const hooks = new Hooks(store, courier);
  const runner = new Runner(store, courier, hooks);
  const projects = new Projects(store);
  return { store, courier, work, hooks, runner, projects };
}
