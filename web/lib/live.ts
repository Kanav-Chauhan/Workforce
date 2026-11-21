// The dashboard's copy of the server state, kept fresh by /live (or by the demo story).
// Components read it with useLive(); the office also listens to raw events to act them out.

"use client";

import { useSyncExternalStore } from "react";
import type { Activity, LiveEvent, LiveFrame, LiveState, Message, Need, Task, Agent, Project, Usage } from "../../shared/types";

export interface View extends LiveState {
  connected: boolean;
  /** Bumped on every init, so the office knows to start over. */
  epoch: number;
}

const EMPTY: View = {
  projects: [],
  agents: [],
  tasks: [],
  needs: [],
  usage: { percent: null, resetsAt: null, limit: 90, pausedByOwner: false, paused: false },
  activity: [],
  messages: [],
  connected: false,
  epoch: 0,
};

const upsert = <T, K>(list: T[], item: T, key: (x: T) => K): T[] => {
  const k = key(item);
  const i = list.findIndex((x) => key(x) === k);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
};
const keep = <T,>(list: T[], max: number) => (list.length > max ? list.slice(list.length - max) : list);

export type EventListener = (e: LiveEvent | { type: "init"; state: LiveState }, view: View) => void;

export class LiveStore {
  view: View = EMPTY;
  private subs = new Set<() => void>();
  private eventSubs = new Set<EventListener>();

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  onEvent(fn: EventListener) {
    this.eventSubs.add(fn);
    return () => void this.eventSubs.delete(fn);
  }
  get = () => this.view;

  private set(v: View) {
    this.view = v;
    for (const fn of this.subs) fn();
  }

  setConnected(connected: boolean) {
    if (this.view.connected !== connected) this.set({ ...this.view, connected });
  }

  setUsage(usage: Usage) {
    this.set({ ...this.view, usage });
  }

  apply(f: LiveFrame) {
    const v = this.view;
    switch (f.type) {
      case "init":
        this.set({ ...f.state, connected: v.connected, epoch: v.epoch + 1 });
        break;
      case "usage":
        this.set({ ...v, usage: f.usage });
        return;
      case "project":
        this.set({ ...v, projects: upsert<Project, string>(v.projects, f.project, (x) => x.id) });
        break;
      case "agent":
        this.set({ ...v, agents: upsert<Agent, string>(v.agents, f.agent, (x) => x.id) });
        break;
      case "task":
        this.set({ ...v, tasks: upsert<Task, string>(v.tasks, f.task, (x) => x.id) });
        break;
      case "need": {
        const needs = f.need.status === "open" ? upsert<Need, number>(v.needs, f.need, (x) => x.id) : v.needs.filter((n) => n.id !== f.need.id);
        this.set({ ...v, needs });
        break;
      }
      case "activity":
        this.set({ ...v, activity: keep(upsert<Activity, number>(v.activity, f.activity, (x) => x.id), 400) });
        break;
      case "message":
        this.set({ ...v, messages: keep(upsert<Message, number>(v.messages, f.message, (x) => x.id), 400) });
        break;
    }
    for (const fn of this.eventSubs) {
      try {
        fn(f, this.view);
      } catch (err) {
        console.warn("office listener failed", err);
      }
    }
  }
}

export const store = new LiveStore();

export const useLive = () => useSyncExternalStore(store.subscribe, store.get, () => EMPTY);

/** Connects to /live and reconnects after drops (1 s, 2 s, 4 s … up to 15 s). */
export function connectLive(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      delay = 1000;
      store.setConnected(true);
    };
    ws.onmessage = (m) => {
      try {
        store.apply(JSON.parse(String(m.data)) as LiveFrame);
      } catch (err) {
        console.warn("bad live frame", err);
      }
    };
    ws.onclose = () => {
      store.setConnected(false);
      if (stopped) return;
      timer = setTimeout(open, delay);
      delay = Math.min(15000, delay * 2);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
