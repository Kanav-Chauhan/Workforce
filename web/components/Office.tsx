"use client";

// The office view: the SVG engine, driven by live events through the Director.

import { useEffect, useRef } from "react";
import { onBoard } from "../../shared/boards";
import { Director } from "../lib/director";
import { store, type View } from "../lib/live";
import { OfficeEngine, type Pick } from "../lib/office/engine";

export function Office({ projectId, selected, onPick, board, boards, officeName, children }: { projectId: string; selected: string | null; onPick: (p: Pick) => void; board: string; boards: string[]; officeName: string; children?: React.ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const director = new Director(projectId);
    const engine = new OfficeEngine(svgRef.current!, stageRef.current!, { onPick: (p) => pickRef.current(p), isOpen: (id) => director.isOpen(id) });
    engineRef.current = engine;

    const mine = (v: View) => ({
      agents: v.agents.filter((a) => a.projectId === projectId),
      tasks: v.tasks.filter((t) => t.projectId === projectId),
      needs: v.needs.filter((n) => n.projectId === projectId),
    });
    const start = (v: View) => {
      const m = mine(v);
      engine.setTeam(m.agents);
      engine.sync(m.agents, m.tasks, m.needs);
      engine.play(director.init({ ...m, messages: v.messages, prs: v.prs }));
    };
    start(store.view);
    const off = store.onEvent((e, v) => {
      if (e.type === "init") {
        // A fresh start (reconnect or demo restart): rebuild from the snapshot.
        engine.setTeam([]);
        start(v);
        return;
      }
      const m = mine(v);
      if (e.type === "agent" && e.agent.projectId === projectId && engine.setTeam(m.agents)) {
        // Someone joined or left: the office was redrawn, start from the snapshot.
        engine.sync(m.agents, m.tasks, m.needs);
        engine.play(director.init({ ...m, messages: v.messages, prs: v.prs }));
        return;
      }
      const acts = director.apply(e);
      engine.sync(m.agents, m.tasks, m.needs);
      engine.play(acts);
    });
    return () => {
      off();
      engine.destroy();
      engineRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    engineRef.current?.select(selected);
  }, [selected]);

  const boardsKey = boards.join("\u0000");
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    // Only show a board name on the wall when there is more than one board.
    e.setBoard(boards.length > 1 ? board : "", (t) => onBoard(t, board, boards));
    const v = store.view;
    e.sync(v.agents.filter((a) => a.projectId === projectId), v.tasks.filter((t) => t.projectId === projectId), v.needs.filter((n) => n.projectId === projectId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, boardsKey, projectId]);

  useEffect(() => {
    engineRef.current?.setOfficeName(officeName);
  }, [officeName]);

  return (
    <div ref={stageRef} className="stage relative h-full min-h-0 overflow-hidden">
      <svg ref={svgRef} className="block h-full w-full" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The office: every agent in their cabin" />
      <div data-hud className="absolute right-3.5 bottom-3.5 flex flex-col overflow-hidden rounded-[10px] bg-white shadow-card">
        <button aria-label="Zoom in" className="h-8 w-[34px] text-[17px] text-[#4a4f5c] hover:bg-soft" onClick={() => engineRef.current?.zoom(0.8)}>
          +
        </button>
        <button aria-label="Zoom out" className="h-8 w-[34px] border-t border-line text-[17px] text-[#4a4f5c] hover:bg-soft" onClick={() => engineRef.current?.zoom(1.25)}>
          −
        </button>
        <button aria-label="Fit the office" className="h-8 w-[34px] border-t border-line text-[15px] text-[#4a4f5c] hover:bg-soft" onClick={() => engineRef.current?.fit()}>
          ⤢
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3.5 left-3.5 hidden rounded-lg bg-white/80 px-2.5 py-1 text-xs text-muted md:block">Drag to move · scroll to zoom · click anyone or a sticky note</div>
      {children}
    </div>
  );
}
