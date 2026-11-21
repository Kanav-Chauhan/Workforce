// Where each task card sits on the office's plan board. Pure maths, no DOM, so it is unit-tested.
//
// The board is a white panel on the back wall split into four lanes. Each lane shows a short stack
// of cards; anything that doesn't fit is summed up in a "+N" line at the foot of the lane.

import type { Task } from "../../../shared/types";

export const BOARD = { left: 842, top: 60, width: 366, height: 236, inset: 10 } as const;
export const CARD = { w: 70, h: 38 } as const;

const LANE_GAP = 6;
export const LANE_W = (BOARD.width - BOARD.inset * 2 - LANE_GAP * 3) / 4; // 82
const STACK_TOP = 116; // first card's top edge, below the lane titles
const STACK_STEP = 42;
export const STACK_SIZE = 4;

export interface Lane {
  title: string;
  /** Statuses that land in this lane. Blocked work stays in "Working" with a red dot. */
  holds: Task["status"][];
  /** Which end of the lane to keep when it overflows. */
  keep: "oldest" | "newest";
  wash: string;
}

export const LANES: Lane[] = [
  { title: "To do", holds: ["todo"], keep: "oldest", wash: "#f5f4f1" },
  { title: "Working", holds: ["working", "blocked"], keep: "oldest", wash: "#f5f4f1" },
  { title: "Review", holds: ["review"], keep: "oldest", wash: "#f5f4f1" },
  { title: "Done", holds: ["done"], keep: "newest", wash: "#eef8f2" },
];

export const laneLeft = (lane: number) => BOARD.left + BOARD.inset + lane * (LANE_W + LANE_GAP);
export const laneIndex = (status: Task["status"]) => LANES.findIndex((l) => l.holds.includes(status));

/** Top-left corner of the card in stack position `slot` of `lane`. */
export function cardSpot(lane: number, slot: number) {
  return { x: laneLeft(lane) + (LANE_W - CARD.w) / 2, y: STACK_TOP + slot * STACK_STEP };
}

export interface Placement {
  task: Task;
  lane: number;
  slot: number;
}

export interface Overflow {
  lane: number;
  label: string;
  x: number;
  y: number;
}

/** Decides which tasks get a card and where; returns the "+N" notes for crowded lanes. */
export function arrange(tasks: Task[]): { placed: Placement[]; overflow: Overflow[] } {
  const placed: Placement[] = [];
  const overflow: Overflow[] = [];
  LANES.forEach((lane, i) => {
    // To do reads in creation order; the rest in the order things last moved.
    const stamp = (t: Task) => (i === 0 ? t.createdAt : t.updatedAt);
    const mine = tasks.filter((t) => lane.holds.includes(t.status)).sort((a, b) => stamp(a).localeCompare(stamp(b)));
    const hidden = Math.max(0, mine.length - STACK_SIZE);
    const kept = lane.keep === "newest" ? mine.slice(hidden) : mine.slice(0, STACK_SIZE);
    kept.forEach((task, slot) => placed.push({ task, lane: i, slot }));
    if (hidden)
      overflow.push({ lane: i, label: lane.keep === "newest" ? `+${hidden} earlier` : `+${hidden} more`, x: laneLeft(i) + LANE_W / 2, y: BOARD.top + BOARD.height - 15 });
  });
  return { placed, overflow };
}
