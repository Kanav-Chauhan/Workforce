"use client";

// One page, two screens: the projects list, or one project's office (?p=<id>). ?demo=1 plays the demo story.

import { useEffect, useState } from "react";
import { Projects } from "../components/Projects";
import { ProjectScreen } from "../components/ProjectScreen";
import { setDemoApi } from "../lib/api";
import { DemoStory } from "../lib/demo";
import { setDemoTerminals } from "../lib/term/link";
import { connectLive, store } from "../lib/live";

interface Route {
  project: string | null;
  demo: boolean;
}

const readRoute = (): Route => {
  const q = new URLSearchParams(location.search);
  const demo = q.get("demo") === "1";
  return { demo, project: q.get("p") ?? (demo && !q.get("list") ? "demo-repo" : null) };
};

export default function Home() {
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    const r = readRoute();
    setRoute(r);
    const onPop = () => setRoute(readRoute());
    addEventListener("popstate", onPop);
    let stop: () => void;
    if (r.demo) {
      const story = new DemoStory((f) => store.apply(f), Number(new URLSearchParams(location.search).get("workers") ?? 2));
      setDemoApi((m, p, b) => story.handle(m, p, b));
      setDemoTerminals((kind, id, ev) => story.openTerminal(kind, id, ev));
      store.setConnected(true);
      story.start();
      stop = () => {
        story.stop();
        setDemoApi(null);
        setDemoTerminals(null);
      };
    } else stop = connectLive();
    return () => {
      removeEventListener("popstate", onPop);
      stop();
    };
  }, []);

  if (!route) return null;
  const open = (id: string) => {
    const q = new URLSearchParams();
    if (route.demo) q.set("demo", "1");
    q.set("p", id);
    history.pushState(null, "", `?${q}`);
    setRoute({ ...route, project: id });
  };
  return route.project ? <ProjectScreen key={route.project} projectId={route.project} demo={route.demo} /> : <Projects demo={route.demo} open={open} />;
}
