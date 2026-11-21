// The plan board on the office wall: one paper card per task. Cards spring to their lane when a
// task moves, pop in when it appears and shrink away when it leaves the board.

import type { Task } from "../../../shared/types";
import { arrange, BOARD, CARD, cardSpot, LANES, laneLeft, LANE_W } from "./planBoard";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
const STIFFNESS = 90; // spring pull towards the card's spot
const DAMPING = 2 * Math.sqrt(STIFFNESS); // critically damped: arrives without wobbling
const GROW_RATE = 9; // how fast cards pop in and shrink out

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The static board panel (lanes and titles), as SVG markup. */
export function boardMarkup(): string {
  const { left, top, width, height } = BOARD;
  let out = `<g filter="url(#fSh)"><rect x="${left}" y="${top}" width="${width}" height="${height}" rx="10" fill="#fff"/></g>`;
  out += `<text class="planTitle" x="${left + 18}" y="${top + 22}" font-family="${FONT}" font-size="13" font-weight="700" fill="#2b2f3a">Plan</text>`;
  LANES.forEach((lane, i) => {
    const x = laneLeft(i);
    out += `<rect x="${x}" y="${top + 32}" width="${LANE_W}" height="${height - 42}" rx="7" fill="${lane.wash}"/>`;
    out += `<text x="${x + 8}" y="${top + 48}" font-family="${FONT}" font-size="10.5" font-weight="600" fill="#7a7f8c">${lane.title}</text>`;
  });
  return out;
}

interface Card {
  node: SVGGElement;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  goal: { x: number; y: number };
  size: number;
  leaving: boolean;
  /** What the card currently shows; redraw only when this changes. */
  face: string;
}

export class PlanWall {
  private cards = new Map<string, Card>();
  private footnotes: SVGGElement;

  /** `paperFor` picks a card colour (e.g. from the owner's look). */
  constructor(private layer: SVGGElement, private paperFor: (t: Task) => string) {
    this.footnotes = document.createElementNS(SVG_NS, "g");
    layer.appendChild(this.footnotes);
  }

  /** Brings the board in line with the task list. Cheap; call on every change. */
  show(tasks: Task[]) {
    const { placed, overflow } = arrange(tasks);
    const onBoard = new Set<string>();
    for (const { task, lane, slot } of placed) {
      onBoard.add(task.id);
      const goal = cardSpot(lane, slot);
      const card = this.cards.get(task.id) ?? this.newCard(task.id, goal);
      card.goal = goal;
      card.leaving = false;
      this.paint(card, task);
    }
    for (const [id, card] of this.cards) if (!onBoard.has(id)) card.leaving = true;
    this.footnotes.innerHTML = overflow
      .map((o) => `<text x="${o.x}" y="${o.y}" text-anchor="middle" font-family="${FONT}" font-size="9.5" font-weight="600" fill="#7a7f8c">${o.label}</text>`)
      .join("");
  }

  /** Moves the cards one animation frame forward. */
  step(dt: number) {
    const grow = 1 - Math.exp(-dt * GROW_RATE);
    for (const [id, c] of this.cards) {
      for (const axis of ["x", "y"] as const) {
        const pull = STIFFNESS * (c.goal[axis] - c.pos[axis]) - DAMPING * c.vel[axis];
        c.vel[axis] += pull * dt;
        c.pos[axis] += c.vel[axis] * dt;
      }
      c.size += ((c.leaving ? 0 : 1) - c.size) * grow;
      if (c.leaving && c.size < 0.02) {
        c.node.remove();
        this.cards.delete(id);
        continue;
      }
      // Lean into the direction of travel and lift a little while flying between lanes.
      const lean = Math.max(-12, Math.min(12, c.vel.x * 0.02));
      const lift = Math.min(10, Math.abs(c.vel.x) * 0.015);
      const cx = CARD.w / 2, cy = CARD.h / 2;
      c.node.setAttribute(
        "transform",
        `translate(${(c.pos.x + cx).toFixed(1)},${(c.pos.y + cy - lift).toFixed(1)}) rotate(${lean.toFixed(1)}) scale(${c.size.toFixed(3)}) translate(${-cx},${-cy})`,
      );
    }
  }

  private newCard(id: string, at: { x: number; y: number }): Card {
    const node = document.createElementNS(SVG_NS, "g");
    node.setAttribute("data-pick", `task:${id}`);
    node.setAttribute("class", "pickable");
    this.layer.insertBefore(node, this.footnotes);
    const card: Card = { node, pos: { ...at }, vel: { x: 0, y: 0 }, goal: at, size: 0, leaving: false, face: "" };
    this.cards.set(id, card);
    return card;
  }

  private paint(card: Card, t: Task) {
    const blocked = t.status === "blocked";
    const paper = blocked ? "#ffd4cf" : this.paperFor(t);
    const face = [t.id, t.title, paper, blocked].join("\u0000");
    if (face === card.face) return;
    card.face = face;
    card.node.innerHTML =
      `<g filter="url(#fSm)"><rect width="${CARD.w}" height="${CARD.h}" rx="5" fill="${paper}"/></g>` +
      (blocked ? `<circle cx="${CARD.w - 8}" cy="8" r="4" fill="#e5534b"/>` : "") +
      `<text x="7" y="15" font-family="${FONT}" font-size="10.5" font-weight="700" fill="#2b2f3a">${xml(t.id)}</text>` +
      `<text x="7" y="29" font-family="${FONT}" font-size="8.5" fill="#4a4f5c">${xml(shorten(t.title, 13))}</text>`;
  }
}

/** A pale paper colour made from a person's shirt colour. */
export function paperFromShirt(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const fade = (c: number) => Math.round(c + (255 - c) * 0.72);
  return `rgb(${fade((n >> 16) & 255)},${fade((n >> 8) & 255)},${fade(n & 255)})`;
}
