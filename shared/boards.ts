// Plan boards: a project has one or more named boards ("v1", "Polish"). A task's `phase` field is
// the name of its board; an empty one means the project's first board.

import type { Project, Task } from "./types.ts";

export const DEFAULT_BOARD = "Main";

export function cleanBoardName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** The project's boards in order, plus any board a task names that isn't on the list yet. */
export function boardsOf(project: Pick<Project, "boards">, tasks: Pick<Task, "phase">[] = []): string[] {
  const out: string[] = [];
  const add = (b: string) => {
    const n = cleanBoardName(b);
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  for (const b of project.boards) add(b);
  if (!out.length) out.push(DEFAULT_BOARD);
  for (const t of tasks) add(t.phase);
  return out;
}

/** Which board a task is on (matched without caring about case). */
export function boardOf(task: Pick<Task, "phase">, boards: string[]): string {
  const p = cleanBoardName(task.phase).toLowerCase();
  if (!p) return boards[0] ?? DEFAULT_BOARD;
  return boards.find((b) => b.toLowerCase() === p) ?? cleanBoardName(task.phase);
}

export const onBoard = (task: Pick<Task, "phase">, board: string, boards: string[]) => boardOf(task, boards).toLowerCase() === board.toLowerCase();
