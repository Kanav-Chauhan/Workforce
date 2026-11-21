// Wires the parts together. Kept separate from main.ts so tests can build an app without listening.

import { Db } from "./db.ts";
import { Delivery } from "./delivery.ts";
import { Hooks } from "./hooks.ts";
import { Projects } from "./projects.ts";
import { Runner, sessionName } from "./runner.ts";
import { Store } from "./store.ts";
import { tmux } from "./tmux.ts";
import { readUsage } from "./usage.ts";
import { Work } from "./work.ts";

export interface App {
  store: Store;
  delivery: Delivery;
  work: Work;
  hooks: Hooks;
  runner: Runner;
  projects: Projects;
}

export function createApp(db = new Db()): App {
  const store = new Store(db);
  const delivery = new Delivery(store, {
    type: async (agentId, text) => {
      const a = db.agent(agentId);
      return !!a && tmux.type(sessionName(a), text);
    },
    enter: async (agentId) => {
      const a = db.agent(agentId);
      return !!a && tmux.key(sessionName(a), "Enter");
    },
  });
  let usageAt = 0;
  let usagePaused = false;
  delivery.paused = () => {
    if (Date.now() - usageAt > 30_000) {
      usagePaused = readUsage(db).paused;
      usageAt = Date.now();
    }
    return usagePaused;
  };
  const work = new Work(store, delivery);
  const hooks = new Hooks(store, delivery);
  const runner = new Runner(store, delivery, hooks);
  const projects = new Projects(store);
  return { store, delivery, work, hooks, runner, projects };
}
