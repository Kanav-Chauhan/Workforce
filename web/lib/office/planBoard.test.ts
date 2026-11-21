import { describe, expect, it } from "vitest";
import type { Task } from "../../../shared/types";
import { arrange, cardSpot, laneIndex } from "./planBoard";

let n = 0;
const task = (status: Task["status"], at: string): Task =>
  ({ id: `T-${++n}`, projectId: "p", title: "x", status, ownerId: null, createdAt: at, updatedAt: at }) as unknown as Task;

describe("plan board", () => {
  it("puts blocked work in the Working lane", () => {
    expect(laneIndex("blocked")).toBe(laneIndex("working"));
  });
  it("keeps the oldest to-dos and the newest done cards", () => {
    const todo = Array.from({ length: 6 }, (_, i) => task("todo", `2026-01-0${i + 1}`));
    const done = Array.from({ length: 6 }, (_, i) => task("done", `2026-01-0${i + 1}`));
    const { placed, overflow } = arrange([...todo, ...done]);
    expect(placed.filter((p) => p.lane === 0).map((p) => p.task.id)).toEqual(todo.slice(0, 4).map((t) => t.id));
    expect(placed.filter((p) => p.lane === 3).map((p) => p.task.id)).toEqual(done.slice(2).map((t) => t.id));
    expect(overflow.map((o) => o.label)).toEqual(["+2 more", "+2 earlier"]);
  });
  it("stacks cards down a lane, centred", () => {
    expect(cardSpot(0, 0)).toEqual({ x: 858, y: 116 });
    expect(cardSpot(3, 1)).toEqual({ x: 1122, y: 158 });
  });
});
