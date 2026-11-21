// The office drawing and its animation: flat SVG, moved by requestAnimationFrame.
// It never decides what happens: the Director turns live events into acts, this file acts them out,
// and sync() keeps screens, lights, the plan wall and the gate in step with the real state.

import { signOf } from "../../../shared/signs";
import type { Agent, Need, Task } from "../../../shared/types";
import { ActQueue, type Act } from "../director";
import { H, LANE, layoutFor, ROWS, W, type Cabin, type Layout, type Member, type Pt } from "./layout";
import { lookOf, type Look } from "./looks";
import { boardMarkup, paperFromShirt, PlanWall } from "./planWall";

const SPEED = 270;
const SCALE = 1.2; // people are a little bigger than in the preview
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const SANS = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const NS = "http://www.w3.org/2000/svg";

const LIGHT: Record<Agent["state"], string> = { off: "#cfd2d8", ready: "#8fb0ff", working: "#2fae7a", "needs-you": "#e8a23a", blocked: "#e5534b" };

export type Pick = { kind: "agent"; id: string } | { kind: "task"; id: string } | { kind: "ceo" } | null;

export interface EngineHooks {
  onPick: (p: Pick) => void;
  isOpen: (needId: number) => boolean;
}

class Cancel extends Error {}

// ------------------------------------------------------------------ svg helpers

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}
function grp(parent: Element | null, html: string, attrs: Record<string, string | number> = {}) {
  const g = el("g", attrs);
  if (html) g.innerHTML = html;
  if (parent) parent.appendChild(g);
  return g;
}
const R = (x: number, y: number, w: number, h: number, fill: string, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const T = (x: number, y: number, txt: string, extra = "") => `<text x="${x}" y="${y}" ${extra}>${esc(txt)}</text>`;

const DEFS = `<defs>
<linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f5f1"/><stop offset="1" stop-color="#efebe4"/></linearGradient>
<linearGradient id="gWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1ede7"/><stop offset="1" stop-color="#e2dcd3"/></linearGradient>
<linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcdcf2"/><stop offset="1" stop-color="#eaf4fb"/></linearGradient>
<linearGradient id="gGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe6f3" stop-opacity=".55"/><stop offset="1" stop-color="#e4f1f8" stop-opacity=".25"/></linearGradient>
<linearGradient id="gWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efdcc2"/><stop offset="1" stop-color="#e2c7a4"/></linearGradient>
<linearGradient id="gWoodF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d3b48c"/><stop offset="1" stop-color="#c4a37a"/></linearGradient>
<linearGradient id="gScreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#1b2335"/></linearGradient>
<linearGradient id="gLounge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6eee2"/><stop offset="1" stop-color="#f0e5d5"/></linearGradient>
<linearGradient id="gGate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ff" stop-opacity=".9"/><stop offset="1" stop-color="#eef1ff" stop-opacity=".2"/></linearGradient>
<radialGradient id="gLeaf" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#7fc79a"/><stop offset="1" stop-color="#3f9466"/></radialGradient>
<filter id="fSh" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#5a4a30" flood-opacity=".15"/></filter>
<filter id="fSm" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#3a3020" flood-opacity=".16"/></filter>
</defs>`;

// ------------------------------------------------------------------ static art

function plant(x: number, y: number, s = 1, pot = "#e8e2d8") {
  return `<g transform="translate(${x},${y}) scale(${s})" filter="url(#fSm)">
    <ellipse cx="0" cy="-34" rx="20" ry="22" fill="url(#gLeaf)"/><ellipse cx="-14" cy="-22" rx="12" ry="14" fill="#55a878"/>
    <ellipse cx="13" cy="-24" rx="12" ry="13" fill="#4b9d6e"/><ellipse cx="2" cy="-48" rx="10" ry="11" fill="#8fd1a7"/>
    <path d="M-13,-12 L13,-12 L10,8 Q0,12 -10,8 Z" fill="${pot}"/><rect x="-14" y="-15" width="28" height="5" rx="2.5" fill="#d9d1c4"/></g>`;
}
function chair(x: number, y: number, c = "#5d6577") {
  return `<g transform="translate(${x},${y})"><ellipse cx="0" cy="10" rx="18" ry="6" fill="rgba(60,50,30,.12)"/>
    <rect x="-17" y="-8" width="34" height="16" rx="7" fill="${c}"/><rect x="-14" y="-30" width="28" height="22" rx="7" fill="${c}" opacity=".92"/>
    <rect x="-10" y="-27" width="20" height="4" rx="2" fill="#fff" opacity=".12"/></g>`;
}
function desk(cx: number, y: number, w: number, mug: string) {
  return `<g filter="url(#fSh)"><rect x="${cx - w / 2}" y="${y}" width="${w}" height="40" rx="7" fill="url(#gWood)"/>
    <rect x="${cx - w / 2}" y="${y + 34}" width="${w}" height="16" rx="5" fill="url(#gWoodF)"/></g>
    <rect x="${cx - 26}" y="${y + 20}" width="52" height="9" rx="3" fill="#f7f7f9" stroke="#d8d8de"/>
    <rect x="${cx + w / 2 - 34}" y="${y + 12}" width="11" height="13" rx="3" fill="${mug}" stroke="#e3ddd3"/>
    <rect x="${cx - w / 2 + 14}" y="${y + 10}" width="26" height="18" rx="2" fill="#fff" stroke="#e8e1d6" transform="rotate(-6 ${cx - w / 2 + 27} ${y + 19})"/>`;
}
function monitor(i: number, cx: number, y: number, w: number) {
  return `<g filter="url(#fSh)"><rect x="${cx - 7}" y="${y + 58}" width="14" height="16" fill="#9aa1ae"/><ellipse cx="${cx}" cy="${y + 76}" rx="24" ry="5" fill="#a9afbb"/>
    <rect x="${cx - w / 2}" y="${y}" width="${w}" height="62" rx="7" fill="#313849"/></g>
    <rect x="${cx - w / 2 + 5}" y="${y + 5}" width="${w - 10}" height="52" rx="4" fill="url(#gScreen)"/>
    <g id="scr-${i}"><text class="l1" x="${cx - w / 2 + 13}" y="${y + 22}" font-family="${MONO}" font-size="9.5" fill="#9fb3d9"></text>
    <text class="l2" x="${cx - w / 2 + 13}" y="${y + 36}" font-family="${MONO}" font-size="10.5" font-weight="600" fill="#eef3ff"></text>
    <g class="code" opacity="0">${[0, 1, 2].map((k) => `<rect class="cl" x="${cx - w / 2 + 13}" y="${y + 44}" height="3" rx="1.5" fill="${["#7fd1b9", "#f3c36b", "#9db8ff"][k]}" width="20"/>`).join("")}</g>
    <rect class="cur" x="${cx - w / 2 + 13}" y="${y + 41}" width="5" height="9" fill="#eef3ff" opacity="0"/></g>`;
}
function shelf(x: number, y: number) {
  return `<g filter="url(#fSm)"><rect x="${x}" y="${y}" width="44" height="64" rx="5" fill="#e8e1d6"/>` +
    [0, 1, 2].map((i) => R(x + 5 + i * 12, y + 8, 9, 22, ["#f0705d", "#e3a52f", "#4f6bed"][i]!, 'rx="2"')).join("") +
    [0, 1].map((i) => R(x + 5 + i * 14, y + 36, 11, 22, ["#22a48e", "#9aa1ae"][i]!, 'rx="2"')).join("") + "</g>";
}

function cabinArt(c: Cabin, i: number) {
  const r = ROWS[c.row], top = c.row === "top", ceo = c.key === "ceo";
  const y0 = top ? 20 : 610, y1 = top ? 420 : 985;
  let s = R(c.x, y0, c.w, y1 - y0, top ? "#f4f2ee" : "#f3f1ed");
  s += `<rect x="${c.x + 24}" y="${top ? 212 : 762}" width="${c.w - 48}" height="${top ? 160 : 150}" rx="22" fill="${c.color}" opacity=".08"/>`;
  if (top) {
    s += R(c.x, 20, c.w, 76, "url(#gWall)") + R(c.x, 94, c.w, 4, "#d8d1c6");
    s += `<rect x="${c.x + 22}" y="32" width="${c.w - 44}" height="48" rx="6" fill="url(#gSky)" stroke="#fff" stroke-width="3"/>`;
    s += `<path d="M${c.x + 40},80 L${c.x + 90},32 L${c.x + 110},32 L${c.x + 60},80Z" fill="#fff" opacity=".35"/>`;
  } else {
    s += R(c.x, 958, c.w, 27, "#e4ded5");
    // a framed picture on the back wall, in the owner's colour
    s += `<g filter="url(#fSm)"><rect x="${c.x + c.w - 74}" y="868" width="44" height="32" rx="3" fill="#fff"/><rect x="${c.x + c.w - 70}" y="872" width="36" height="24" rx="2" fill="${c.color}" opacity=".35"/>
      <path d="M${c.x + c.w - 70},896 l10,-10 l8,6 l8,-9 l10,13z" fill="${c.color}" opacity=".6"/></g>`;
  }
  s += `<g data-pick="${ceo ? "ceo" : `agent:${esc(c.key)}`}" class="pickable">` + R(c.x, y0, c.w, y1 - y0, "transparent") + "</g>";
  s += desk(c.desk, r.desk, c.deskW, ceo ? "#e9edff" : "#fff") + monitor(i, c.desk, r.mon, c.monW);
  s += chair(c.desk, r.seat, ceo ? "#4f6bed" : "#5d6577");
  if (ceo) {
    s += `<g filter="url(#fSh)"><rect x="70" y="260" width="58" height="120" rx="14" fill="#c9cfdc"/><rect x="78" y="268" width="42" height="104" rx="10" fill="#d8dde8"/></g>`;
    s += plant(445, 150, 1.05) + plant(95, 175, 0.8);
    s += `<g filter="url(#fSm)"><rect x="410" y="250" width="44" height="44" rx="22" fill="#fff"/><circle cx="432" cy="272" r="13" fill="#f3efe8"/></g>`;
  } else if (top) {
    s += plant(c.x + c.w - 34, 160, 0.78) + shelf(c.x + 22, 150);
  } else {
    s += plant(c.x + 34, 950, 0.78);
    if (c.w >= 260) s += shelf(c.x + 22, 700);
  }
  return s;
}

function glassArt(c: Cabin) {
  const gy = ROWS[c.row].glass, x0 = c.x, x1 = c.x + c.w, d0 = c.door - 30, d1 = c.door + 30;
  const pane = (a: number, b: number) => {
    if (b - a < 4) return "";
    let s = `<rect x="${a}" y="${gy - 46}" width="${b - a}" height="46" fill="url(#gGlass)"/>`;
    for (let m = a + 70; m < b - 20; m += 70) s += R(m, gy - 46, 2, 46, "#ffffff", 'opacity=".75"');
    if (b - a > 60) s += `<path d="M${a + 18},${gy} L${a + 44},${gy - 46} L${a + 58},${gy - 46} L${a + 32},${gy}Z" fill="#fff" opacity=".38"/>`;
    return s;
  };
  let s = pane(x0, d0) + pane(d1, x1);
  s += R(x0, gy - 49, Math.max(0, d0 - x0), 4, "#cdd4dd", 'rx="2"') + R(d1, gy - 49, x1 - d1, 4, "#cdd4dd", 'rx="2"');
  s += R(x0, gy - 2, Math.max(0, d0 - x0), 4, "#bfc6d0") + R(d1, gy - 2, x1 - d1, 4, "#bfc6d0");
  s += R(d0 - 3, gy - 50, 5, 52, "#b9c1cc", 'rx="2"') + R(d1 - 2, gy - 50, 5, 52, "#b9c1cc", 'rx="2"');
  const rightOfDoor = c.row === "bot" || d0 - x0 < 120;
  const room = rightOfDoor ? x1 - d1 - 22 : d0 - x0 - 22;
  let label = c.label;
  if (label.length * 6.6 + 30 > room) label = label.replace(/\s+(Worker|Lead)$/, "");
  const nx = rightOfDoor ? d1 + 12 : x0 + 16, nw = Math.min(room, Math.max(84, label.length * 6.6 + 30));
  s += `<g data-pick="${c.key === "ceo" ? "ceo" : `agent:${esc(c.key)}`}" class="pickable" filter="url(#fSm)"><rect x="${nx}" y="${gy - 37}" width="${nw}" height="22" rx="7" fill="#fff"/>
    <circle class="light" cx="${nx + 12}" cy="${gy - 26}" r="4.5" fill="#b4b8c2"/>
    ${T(nx + 22, gy - 22, label, `font-family="${SANS}" font-size="11.5" font-weight="600" fill="#2b2f3a"`)}</g>`;
  return s;
}

function planWallArt() {
  let s = R(810, 20, 430, 400, "#f5f3ef") + R(810, 20, 430, 76, "url(#gWall)") + R(810, 94, 430, 4, "#d8d1c6");
  s += boardMarkup();
  s += plant(1215, 404, 0.9);
  return s;
}
function gateArt() {
  let s = R(1240, 20, 340, 400, "#f3f2f6") + R(1240, 20, 340, 76, "url(#gWall)") + R(1240, 94, 340, 4, "#d8d1c6");
  s += `<rect x="1262" y="196" width="296" height="196" rx="30" fill="#4f6bed" opacity=".05"/>`;
  s += T(1410, 70, "Review gate", `text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="700" fill="#4a4f5c"`);
  s += T(1410, 86, "you merge here", `text-anchor="middle" font-family="${SANS}" font-size="10" fill="#9a9fab"`);
  return s;
}
function gateFront() {
  return `<g filter="url(#fSh)"><rect x="1318" y="128" width="16" height="210" rx="6" fill="#dfe3ec"/><rect x="1486" y="128" width="16" height="210" rx="6" fill="#dfe3ec"/>
    <rect x="1304" y="118" width="212" height="26" rx="10" fill="#fff"/></g>
    <rect x="1334" y="146" width="152" height="190" fill="url(#gGate)"/>
    <circle class="gateLight" cx="1410" cy="131" r="6" fill="#c9cede"/>
    <g filter="url(#fSh)"><rect x="1340" y="336" width="140" height="22" rx="8" fill="#eceef4"/><rect x="1340" y="352" width="140" height="10" rx="4" fill="#d4d8e2"/></g>`;
}
function loungeArt(L: Layout["lounge"]) {
  const cx = L.x + L.w / 2, rx = Math.min(190, L.w * 0.26);
  let s = R(L.x, 610, L.w, 375, "url(#gLounge)") + R(L.x, 958, L.w, 27, "#e4ded5");
  s += `<ellipse cx="${cx}" cy="790" rx="${rx}" ry="${rx * 0.47}" fill="#e9dcc6" opacity=".7"/><ellipse cx="${cx}" cy="790" rx="${rx * 0.79}" ry="${rx * 0.35}" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/>`;
  s += `<g filter="url(#fSh)"><ellipse cx="${cx}" cy="772" rx="46" ry="26" fill="#fff"/><rect x="${cx - 6}" y="772" width="12" height="28" fill="#d9d3c8"/></g>`;
  s += `<circle cx="${cx - 12}" cy="766" r="6" fill="#f0705d" opacity=".75"/><circle cx="${cx + 14}" cy="770" r="6" fill="#4f6bed" opacity=".6"/>`;
  s += T(L.x + 25, 640, "Lounge", `font-family="${SANS}" font-size="13" font-weight="700" fill="#b39a7a"`);
  s += plant(L.x + 25, 700, 0.9) + plant(1555, 690, 1.1);
  if (L.w > 520) s += plant(L.x + L.w * 0.34, 945, 0.8);
  return s;
}
function loungeFront(L: Layout["lounge"]) {
  const sx = L.x + 30;
  const sofa = L.sofa
    ? `<g filter="url(#fSh)"><rect x="${sx}" y="880" width="210" height="66" rx="20" fill="#9fb0d8"/><rect x="${sx + 12}" y="852" width="186" height="44" rx="16" fill="#b6c4e4"/>
      <rect x="${sx}" y="872" width="34" height="70" rx="15" fill="#8d9fcb"/><rect x="${sx + 176}" y="872" width="34" height="70" rx="15" fill="#8d9fcb"/></g>
      <rect x="${sx + 44}" y="866" width="54" height="22" rx="10" fill="#f3c36b" opacity=".9"/>`
    : "";
  return `${sofa}
    <g filter="url(#fSh)"><rect x="1330" y="890" width="220" height="64" rx="10" fill="#fff"/><rect x="1330" y="934" width="220" height="20" rx="6" fill="#e8e2d8"/>
      <rect x="1400" y="842" width="52" height="66" rx="9" fill="#3a4254"/><rect x="1408" y="850" width="36" height="16" rx="4" fill="#58627a"/></g>
    <circle cx="1440" cy="858" r="3" fill="#7fe0b0"/><rect x="1418" y="884" width="16" height="15" rx="3" fill="#fff"/>
    <g class="steam" opacity="0"><path d="M1422,878 q-5,-8 0,-15 q5,-7 0,-14" stroke="#c9ccd4" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M1431,878 q-5,-8 0,-15 q5,-7 0,-14" stroke="#c9ccd4" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>
    ${T(1480, 925, "Coffee", `font-family="${SANS}" font-size="11" font-weight="600" fill="#b39a7a"`)}
    <g filter="url(#fSm)"><rect x="1490" y="876" width="34" height="18" rx="5" fill="#e3a52f" opacity=".85"/></g>`;
}

function hairPaths(style: Look["style"]) {
  if (style === "long")
    return {
      front: "M-12.5,-49 C-14,-66 14,-66 12.5,-49 L12.5,-35 C10,-33 8.6,-36 8.8,-41 L8.8,-52 C4,-56 -4,-56 -8.8,-52 L-8.8,-41 C-8.6,-36 -10,-33 -12.5,-35Z",
      back: "M-12.5,-50 C-14,-66 14,-66 12.5,-50 L12.5,-33 C6,-30 -6,-30 -12.5,-33Z",
    };
  if (style === "bun")
    return {
      front: "M-11.8,-49 C-13,-64 13,-64 11.8,-49 C9,-55 3,-57 -1,-55 C-5,-57 -10,-54 -11.8,-49Z M0,-70 a6,6 0 1,0 0.1,0Z",
      back: "M-12,-50 C-13,-64 13,-64 12,-50 C12,-42 -12,-42 -12,-50Z M0,-70 a6,6 0 1,0 0.1,0Z",
    };
  return {
    front: "M-11.6,-50 C-13,-63 -3,-65 1,-64 C8,-64 13,-60 11.6,-50 C9,-55 4,-56.5 0,-55.5 C-4,-56 -9,-54 -11.6,-50Z",
    back: "M-11.8,-50 C-12.5,-64 12.5,-64 11.8,-50 C11,-43 -11,-43 -11.8,-50Z",
  };
}

// ------------------------------------------------------------------ people

interface Moving {
  pts: Pt[];
  segs: number[];
  len: number;
  t0: number;
  dur: number;
  res: () => void;
  last: number;
}

interface Person {
  id: string; // agent id
  name: string;
  tagText: string;
  look: Look;
  g: SVGGElement;
  x: number;
  y: number;
  pose: "sit" | "stand";
  loc: string;
  phase: number;
  face: 1 | -1;
  back: boolean;
  moving: Moving | null;
  typing: boolean;
  carry: string | null;
  hidden: boolean;
  queue: ActQueue;
  busy: boolean;
  readySince: number; // game time the agent was last seen idle at its desk
  nextIdleTrip: number;
  interrupt: boolean;
  ceoSlot: number;
  parts: Record<string, SVGElement>;
}

interface Bubble {
  p: Person;
  g: SVGGElement;
  w: number;
  born: number;
  until: number;
}

// ------------------------------------------------------------------ the engine

export class OfficeEngine {
  private world!: SVGGElement;
  private lFloor!: SVGGElement;
  private lFurn!: SVGGElement;
  private lActors!: SVGGElement;
  private lFx!: SVGGElement;
  private wall!: PlanWall;
  private trayG!: SVGGElement;
  private actors: { g: SVGGElement; base: () => number }[] = [];
  private lastOrder = "";
  private layout!: Layout;
  private teamKey: string | null = null;
  private people = new Map<string, Person>();
  private cabinIndex = new Map<string, number>();
  private screens = new Map<string, { l1: SVGTextElement; l2: SVGTextElement; code: SVGGElement; cls: SVGRectElement[]; cur: SVGRectElement; typing: boolean }>();
  private agents = new Map<string, Agent>();
  private bubbles: Bubble[] = [];
  private flyers: { g: SVGGElement; from: Pt; to: () => Pt; t0: number; ms: number; res: () => void }[] = [];
  private confetti: ({ n: SVGElement; x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number } | { ring: SVGCircleElement; t0: number })[] = [];
  private tray = new Map<string, SVGGElement>(); // taskId → parcel on the gate
  private doneTasks = new Set<string>();
  private needWaiters = new Map<number, (() => void)[]>();
  private ceoSlots: (string | null)[] = [null, null, null, null];
  private timers: { at: number; res: () => void }[] = [];
  private now = 0;
  private runId = 0;
  private raf = 0;
  private prev = 0;
  private selected: string | null = null;
  private focus: Person | null = null;
  private autoCam = true;
  private vb = { x: 0, y: 0, w: W, h: H };
  private fitW = W;
  private ro: ResizeObserver;
  private cleanup: (() => void)[] = [];

  constructor(private svg: SVGSVGElement, private stage: HTMLElement, private hooks: EngineHooks) {
    svg.innerHTML = DEFS;
    this.world = grp(svg, "", {});
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(stage);
    this.bindPointer();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.cleanup) f();
    this.runId++;
  }

  // ---------------------------------------------------------------- building

  /** Builds (or rebuilds) the office for this team. Everyone starts at their desk. */
  setTeam(team: Agent[]) {
    const members: Member[] = team.map((a) => {
      const look = lookOf(a.sign);
      return { id: a.id, label: `${a.name} ${signSymbol(a.sign)} ${a.isLead ? "Lead" : "Worker"}`, color: look.shirt, isLead: a.isLead };
    });
    const key = members.map((m) => m.id).join(",");
    for (const a of team) this.agents.set(a.id, a);
    if (key === this.teamKey) return false;
    this.teamKey = key;
    this.build(layoutFor(members), team);
    return true;
  }

  private build(layout: Layout, team: Agent[]) {
    this.runId++;
    this.layout = layout;
    this.timers = [];
    this.bubbles = [];
    this.flyers = [];
    this.confetti = [];
    this.tray.clear();
    this.doneTasks.clear();
    this.needWaiters.clear();
    this.ceoSlots = [null, null, null, null];
    this.people.clear();
    this.screens.clear();
    this.cabinIndex.clear();
    this.actors = [];
    this.lastOrder = "";
    this.world.innerHTML = "";
    this.lFloor = grp(this.world, "");
    this.lFurn = grp(this.world, "");
    this.lActors = grp(this.world, "");
    this.lFx = grp(this.world, "");

    this.lFloor.innerHTML = `<rect x="10" y="10" width="1580" height="985" rx="26" fill="#e7e2da"/>
      <rect x="20" y="20" width="1560" height="965" rx="20" fill="url(#gFloor)"/>
      <rect x="20" y="420" width="1560" height="190" fill="#f1eee8"/>
      <rect x="60" y="490" width="1480" height="50" rx="25" fill="#ebe6dd"/>
      ${Array.from({ length: 19 }, (_, i) => `<rect x="${100 + i * 76}" y="513" width="26" height="4" rx="2" fill="#fff" opacity=".8"/>`).join("")}
      ${plant(1555, 455, 0.75)}`;
    layout.cabins.forEach((c, i) => this.cabinIndex.set(c.key, i));
    const hasLead = layout.cabins.some((c) => c.row === "top" && c.key !== "ceo");
    this.lFurn.innerHTML =
      layout.cabins.map((c, i) => cabinArt(c, i)).join("") +
      (hasLead ? "" : R(500, 20, 300, 400, "#f4f2ee") + R(500, 20, 300, 76, "url(#gWall)") + plant(650, 380, 1)) +
      planWallArt() + gateArt() + loungeArt(layout.lounge) +
      layout.walls.top.map((x) => R(x - 6, 20, 12, 400, "#e2dcd3", 'rx="3"')).join("") +
      layout.walls.bot.map((x) => R(x - 6, 610, 12, 375, "#e2dcd3", 'rx="3"')).join("") +
      layout.cabins.map((c, i) => `<rect class="dim" id="dim-${i}" x="${c.x}" y="${c.row === "top" ? 20 : 610}" width="${c.w}" height="${c.row === "top" ? 400 : 375}" fill="#3b4050" opacity="0" pointer-events="none"/>`).join("");
    this.wall = new PlanWall(grp(this.lFurn, ""), (t) => {
      const owner = t.ownerId ? this.agents.get(t.ownerId) : undefined;
      return owner ? paperFromShirt(lookOf(owner.sign).shirt) : "#fff1c2";
    });

    for (const c of layout.cabins) this.addActor(glassArt(c), ROWS[c.row].glass);
    this.addActor(gateFront(), 362);
    this.trayG = this.addActor("", 363);
    this.addActor(loungeFront(layout.lounge), 955);

    layout.cabins.forEach((c, i) => {
      const g = this.svg.querySelector(`#scr-${i}`)!;
      this.screens.set(c.key, {
        l1: g.querySelector(".l1")!, l2: g.querySelector(".l2")!, code: g.querySelector(".code")!,
        cls: [...g.querySelectorAll<SVGRectElement>(".cl")], cur: g.querySelector(".cur")!, typing: false,
      });
    });
    for (const a of team) if (this.cabinIndex.has(a.id)) this.makePerson(a);
    this.setScreen("ceo", "inbox", "your chair", false);
    this.fit();
  }

  private addActor(html: string, base: number) {
    const g = grp(this.lActors, html);
    this.actors.push({ g, base: () => base });
    return g;
  }

  private makePerson(a: Agent) {
    const P = lookOf(a.sign), hp = hairPaths(P.style);
    const tagText = `${a.name} ${signSymbol(a.sign)}`;
    const tw = Math.max(54, tagText.length * 6 + 22);
    const g = grp(null, `
      <g class="sc" transform="scale(${SCALE})">
      <ellipse class="ring" cx="0" cy="0" rx="22" ry="8" fill="none" stroke="${P.shirt}" stroke-width="2.5" opacity="0"/>
      <ellipse cx="0" cy="0" rx="15" ry="5" fill="rgba(50,40,30,.18)"/>
      <g class="body">
        <g class="stand">
          <g class="legL"><rect x="-8" y="-21" width="7" height="21" rx="3.5" fill="${P.pants}"/><ellipse cx="-4.5" cy="-1" rx="5" ry="3" fill="#2b2f3a"/></g>
          <g class="legR"><rect x="1" y="-21" width="7" height="21" rx="3.5" fill="${P.pants}"/><ellipse cx="4.5" cy="-1" rx="5" ry="3" fill="#2b2f3a"/></g>
        </g>
        <g class="up">
          <g class="armL"><rect x="-16" y="-39" width="6" height="19" rx="3" fill="${P.shirt2}"/><circle cx="-13" cy="-20" r="3.4" fill="${P.skin}"/></g>
          <g class="armR"><rect x="10" y="-39" width="6" height="19" rx="3" fill="${P.shirt2}"/><circle cx="13" cy="-20" r="3.4" fill="${P.skin}"/></g>
          <rect x="-11.5" y="-41" width="23" height="25" rx="9" fill="${P.shirt}"/>
          <rect x="-3.5" y="-44" width="7" height="5" fill="${P.skin}"/>
          <circle cx="0" cy="-51" r="11.5" fill="${P.skin}"/>
          <g class="face"><ellipse class="eL" cx="-4" cy="-50" rx="1.5" ry="1.6" fill="#2b2f3a"/><ellipse class="eR" cx="4" cy="-50" rx="1.5" ry="1.6" fill="#2b2f3a"/>
            <circle cx="-7" cy="-46" r="2" fill="#f08c7a" opacity=".35"/><circle cx="7" cy="-46" r="2" fill="#f08c7a" opacity=".35"/>
            <path d="M-2.5,-45.5 Q0,-43.5 2.5,-45.5" stroke="#8a4a3a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
            <path d="${hp.front}" fill="${P.hair}"/></g>
          <path class="hb" d="${hp.back}" fill="${P.hair}" display="none"/>
          <g class="parcel" display="none" filter="url(#fSm)"><rect x="-15" y="-33" width="30" height="20" rx="3" fill="#f3c36b"/><rect x="-15" y="-33" width="30" height="6" rx="3" fill="#e8ad45"/>
            <text x="0" y="-17" text-anchor="middle" font-family="${SANS}" font-size="7.5" font-weight="700" fill="#6b4a10"></text></g>
        </g>
        <rect class="back" x="-15" y="-27" width="30" height="21" rx="7" fill="#5d6577" display="none"/>
      </g>
      <g class="tag" transform="translate(0,-82)"><rect x="${-tw / 2}" y="-9" width="${tw}" height="17" rx="8.5" fill="#fff" opacity=".95" filter="url(#fSm)"/>
        <circle cx="${-tw / 2 + 10}" cy="-0.5" r="3.5" fill="${P.shirt}"/>${T(-tw / 2 + 17, 3.5, tagText, `font-family="${SANS}" font-size="9.5" font-weight="600" fill="#2b2f3a"`)}</g>
      <rect x="-20" y="-80" width="40" height="84" fill="transparent"/>
      </g>`, { "data-pick": `agent:${a.id}`, class: "pickable person" });
    const q = (s: string) => g.querySelector(s) as SVGElement;
    const seat = this.layout.places[a.id]!.seat!;
    const p: Person = {
      id: a.id, name: a.name, tagText, look: P, g, x: seat[0], y: seat[1], pose: "sit", loc: a.id, phase: 0, face: 1, back: true, moving: null,
      typing: false, carry: null, hidden: false, queue: new ActQueue(), busy: false, readySince: this.now, nextIdleTrip: this.idleDelay(), interrupt: false, ceoSlot: -1,
      parts: {
        stand: q(".stand"), legL: q(".legL"), legR: q(".legR"), armL: q(".armL"), armR: q(".armR"), up: q(".up"), face: q(".face"), hb: q(".hb"),
        back: q(".back"), body: q(".body"), parcel: q(".parcel"), ptxt: q(".parcel text"), tag: q(".tag"), eL: q(".eL"), eR: q(".eR"), ring: q(".ring"),
      },
    };
    this.lActors.appendChild(g);
    this.actors.push({ g, base: () => p.y + (p.pose === "sit" ? 4 : 0) });
    this.people.set(a.id, p);
    this.applyPose(p, a, true);
  }

  private idleDelay() {
    return 22000 + Math.random() * 26000;
  }

  // ---------------------------------------------------------------- state sync

  /** Screens, lights, plan wall, gate and CEO screen follow the real state. Cheap; call on every change. */
  sync(agents: Agent[], tasks: Task[], needs: Need[]) {
    if (!this.layout) return;
    for (const a of agents) {
      this.agents.set(a.id, a);
      const i = this.cabinIndex.get(a.id);
      if (i === undefined) continue;
      const light = this.svg.querySelectorAll(".light")[i] as SVGElement | undefined;
      light?.setAttribute("fill", LIGHT[a.state]);
      (this.svg.querySelector(`#dim-${i}`) as SVGElement | null)?.setAttribute("opacity", a.state === "off" ? ".16" : "0");
      const note = a.note || "";
      const l1 = { off: "", ready: a.taskId ? `${a.taskId} · ready` : "ready", working: a.taskId ? `${a.taskId} · working` : "working", "needs-you": "waiting for you", blocked: "blocked" }[a.state];
      const l2 = a.state === "off" ? "off" : clip(note.replace(/^Editing /, "editing ").replace(/^Running /, "running ").replace(/^Reading /, "reading ") || (a.state === "ready" ? "idle" : a.state), Math.floor((this.cabin(a.id)!.monW - 26) / 6.4));
      this.setScreen(a.id, l1, l2, a.state === "working");
      const p = this.people.get(a.id);
      if (p && !p.busy) this.applyPose(p, a, false);
    }
    const open = needs.filter((n) => n.status === "open").length;
    this.setScreen("ceo", open ? "needs you" : "inbox", open ? `${open} waiting` : "all clear", false);
    this.wall.show(tasks);
    this.syncTray(tasks);
  }

  private cabin(key: string) {
    const i = this.cabinIndex.get(key);
    return i === undefined ? undefined : this.layout.cabins[i];
  }

  private setScreen(key: string, l1: string, l2: string, typing: boolean) {
    const s = this.screens.get(key);
    if (!s) return;
    s.l1.textContent = l1;
    s.l2.textContent = l2;
    s.typing = typing;
    s.code.setAttribute("opacity", typing ? "1" : "0");
  }

  /** At the desk: typing when working, hidden when off. Away from the desk: go back. */
  private applyPose(p: Person, a: Agent, instant: boolean) {
    const off = a.state === "off";
    if (off) {
      p.hidden = true;
      p.typing = false;
      if (!p.busy) this.placeHome(p);
      p.g.setAttribute("display", "none");
      return;
    }
    if (p.hidden) {
      p.hidden = false;
      p.g.setAttribute("display", "");
      this.placeHome(p);
    }
    p.typing = a.state === "working" && p.pose === "sit" && p.loc === p.id;
    if (a.state !== "ready" || p.typing) {
      p.readySince = this.now;
      p.interrupt = a.state === "working";
    }
    if (!instant && !p.busy && (p.loc !== p.id || p.pose !== "sit")) void this.pump(p);
  }

  private placeHome(p: Person) {
    const s = this.layout.places[p.id]!.seat!;
    Object.assign(p, { x: s[0], y: s[1], pose: "sit", loc: p.id, moving: null, back: true, carry: null });
    this.freeCeoSlot(p);
  }

  private syncTray(tasks: Task[]) {
    // Parcels leave the gate when their task leaves review (merged, closed or reworked).
    for (const [id, g] of this.tray) {
      const t = tasks.find((x) => x.id === id);
      if (!t || t.status !== "review") {
        if (t?.status !== "done") g.remove(), this.tray.delete(id);
      }
    }
  }

  private dropParcel(taskId: string, pr: number) {
    if (this.tray.has(taskId) || this.doneTasks.has(taskId)) return;
    const g = grp(this.trayG, `<g filter="url(#fSm)"><rect x="-17" y="-20" width="34" height="22" rx="3" fill="#f3c36b"/><rect x="-17" y="-20" width="34" height="6" rx="3" fill="#e8ad45"/></g>
      ${T(0, -3, `PR #${pr}`, `text-anchor="middle" font-family="${SANS}" font-size="8" font-weight="700" fill="#6b4a10"`)}`, { "data-pick": `task:${taskId}`, class: "pickable" });
    this.tray.set(taskId, g);
    this.layoutTray();
  }

  private layoutTray() {
    let i = 0;
    for (const g of this.tray.values()) {
      const visible = i < 3;
      g.setAttribute("display", visible ? "" : "none");
      g.setAttribute("transform", `translate(${1372 + i * 38},344)`);
      i++;
    }
  }

  // ---------------------------------------------------------------- acts

  /** Plays acts from the Director. Walking acts wait in the agent's queue; the rest happen now. */
  play(acts: Act[]) {
    for (const a of acts) {
      switch (a.kind) {
        case "pose": {
          const p = this.people.get(a.agentId), ag = this.agents.get(a.agentId);
          if (p && ag && !p.busy) this.applyPose(p, ag, false);
          break;
        }
        case "envelope": {
          const p = this.people.get(a.toId);
          if (!p || p.hidden) break;
          const from: Pt = a.from === "owner" ? [250, 140] : [30, LANE];
          void this.envelope(from, () => [p.x, p.y - 60 * SCALE], a.from === "owner" ? "#4f6bed" : "#9aa1ae");
          break;
        }
        case "needDone": {
          for (const p of this.people.values()) p.queue.dropNeed(a.needId);
          const ws = this.needWaiters.get(a.needId);
          this.needWaiters.delete(a.needId);
          ws?.forEach((f) => f());
          break;
        }
        case "done":
          this.celebrateDone(a.taskId);
          break;
        case "parcel":
          if (a.instant) {
            this.dropParcel(a.taskId, a.pr);
            break;
          }
        // fall through: carried by its owner
        case "visit":
        case "askCeo": {
          const p = this.people.get(a.agentId);
          if (!p) break;
          if (a.kind === "askCeo" && a.instant) {
            this.instantAsk(p, a.needId, a.text);
            break;
          }
          p.queue.push(a);
          p.interrupt = true;
          void this.pump(p);
          break;
        }
      }
    }
  }

  private async pump(p: Person) {
    if (p.busy) return;
    p.busy = true;
    const id = this.runId;
    try {
      for (let act = p.queue.next(); act; act = p.queue.next()) {
        p.interrupt = false;
        if (p.hidden) {
          if (act.kind === "parcel") this.dropParcel(act.taskId, act.pr);
          continue;
        }
        await this.act(p, act);
      }
      await this.goHome(p);
    } catch (e) {
      if (!(e instanceof Cancel)) console.warn("office act failed", e);
    } finally {
      if (id === this.runId) {
        p.busy = false;
        const a = this.agents.get(p.id);
        if (a) this.applyPose(p, a, true);
        if (p.queue.length) void this.pump(p);
      }
    }
  }

  private async act(p: Person, a: Act) {
    if (a.kind === "visit") {
      const target = this.people.get(a.toId);
      if (!this.layout.places[a.toId]) return;
      await this.walk(p, a.toId, "visit");
      p.face = -1;
      await this.sayFor(p, a.text, 1800 + a.text.length * 35);
      if (target && !target.hidden && target.loc === target.id && !target.busy) await this.sayFor(target, pickReply(a.text), 1100);
    } else if (a.kind === "askCeo") {
      if (!this.hooks.isOpen(a.needId)) return;
      const slot = this.takeCeoSlot(p);
      await this.walk(p, "ceo", `s${slot}`);
      p.back = true;
      if (!this.hooks.isOpen(a.needId)) return;
      const b = this.say(p, a.text);
      await this.waitNeed(a.needId);
      this.kill(b);
      p.back = false;
      await this.sayFor(p, "Thanks!", 900);
      this.freeCeoSlot(p);
    } else if (a.kind === "parcel") {
      p.carry = `PR #${a.pr}`;
      p.parts.ptxt!.textContent = p.carry;
      await this.walk(p, "gate");
      p.back = true;
      await this.wait(300);
      p.carry = null;
      this.dropParcel(a.taskId, a.pr);
      await this.wait(300);
    }
  }

  private instantAsk(p: Person, needId: number, text: string) {
    if (!this.hooks.isOpen(needId) || p.hidden) return;
    const slot = this.takeCeoSlot(p);
    const spot = this.layout.places.ceo![`s${slot}`]!;
    Object.assign(p, { x: spot[0], y: spot[1], pose: "stand", loc: "ceo", typing: false, back: true });
    p.busy = true;
    const id = this.runId;
    const b = this.say(p, text);
    void this.waitNeed(needId)
      .then(async () => {
        this.kill(b);
        p.back = false;
        await this.sayFor(p, "Thanks!", 900);
        this.freeCeoSlot(p);
        await this.goHome(p);
      })
      .catch(() => {})
      .finally(() => {
        if (id !== this.runId) return;
        p.busy = false;
        const a = this.agents.get(p.id);
        if (a) this.applyPose(p, a, true);
        if (p.queue.length) void this.pump(p);
      });
  }

  private takeCeoSlot(p: Person) {
    if (p.ceoSlot >= 0) return p.ceoSlot;
    let i = this.ceoSlots.indexOf(null);
    if (i < 0) i = 0;
    this.ceoSlots[i] = p.id;
    p.ceoSlot = i;
    return i;
  }
  private freeCeoSlot(p: Person) {
    if (p.ceoSlot >= 0 && this.ceoSlots[p.ceoSlot] === p.id) this.ceoSlots[p.ceoSlot] = null;
    p.ceoSlot = -1;
  }

  private waitNeed(needId: number) {
    const id = this.runId;
    if (!this.hooks.isOpen(needId)) return Promise.resolve();
    return new Promise<void>((res) => {
      const list = this.needWaiters.get(needId) ?? [];
      list.push(res);
      this.needWaiters.set(needId, list);
    }).then(() => this.guard(id));
  }

  private async goHome(p: Person) {
    const a = this.agents.get(p.id);
    if (!a || a.state === "off") {
      this.placeHome(p);
      return;
    }
    if (p.loc !== p.id || p.pose !== "sit") await this.sit(p);
  }

  private celebrateDone(taskId: string) {
    this.doneTasks.add(taskId);
    const g = this.tray.get(taskId);
    const light = this.svg.querySelector(".gateLight");
    light?.setAttribute("fill", "#2fae7a");
    this.celebrate(1410, 300);
    if (g) {
      g.style.transition = "opacity .6s";
      g.style.opacity = "0";
      setTimeout(() => {
        g.remove();
        if (this.tray.get(taskId) === g) this.tray.delete(taskId);
        this.layoutTray();
      }, 700);
    }
    setTimeout(() => light?.setAttribute("fill", "#c9cede"), 1600);
  }

  // ---------------------------------------------------------------- idle life

  private async idleTrip(p: Person) {
    p.busy = true;
    const id = this.runId;
    try {
      const coffee = Math.random() < 0.55;
      const spot = coffee ? "coffee" : (["w1", "w2", "w3"] as const)[Math.floor(Math.random() * 3)]!;
      await this.walk(p, "lounge", spot);
      if (coffee) {
        p.back = true;
        this.svg.querySelector(".steam")?.setAttribute("opacity", "1");
        await this.wait(1800, p);
        this.svg.querySelector(".steam")?.setAttribute("opacity", "0");
        p.back = false;
        if (!p.interrupt) await this.sayFor(p, Math.random() < 0.5 ? "Coffee ☕" : "Ahh, better", 1100);
      } else {
        p.back = false;
        await this.wait(2500 + Math.random() * 2000, p);
      }
      await this.goHome(p);
    } catch (e) {
      if (!(e instanceof Cancel)) console.warn(e);
    } finally {
      if (id === this.runId) {
        p.busy = false;
        p.readySince = this.now;
        p.nextIdleTrip = this.idleDelay();
        const a = this.agents.get(p.id);
        if (a) this.applyPose(p, a, true);
        if (p.queue.length) void this.pump(p);
      }
    }
  }

  private checkIdle() {
    for (const p of this.people.values()) {
      const a = this.agents.get(p.id);
      if (!a || a.state !== "ready" || p.busy || p.hidden || p.queue.length) {
        if (a && a.state !== "ready") p.readySince = this.now;
        continue;
      }
      if (this.now - p.readySince > p.nextIdleTrip) {
        p.interrupt = false;
        void this.idleTrip(p);
      }
    }
  }

  // ---------------------------------------------------------------- timers + movement

  private guard(id: number) {
    if (id !== this.runId) throw new Cancel();
  }

  /** Waits in office time (pauses with the tab). With a person, ends early when they get something to do. */
  private wait(ms: number, p?: Person) {
    const id = this.runId;
    return new Promise<void>((res) => {
      const at = this.now + ms;
      this.timers.push({ at, res });
      if (p) {
        const check = () => {
          if (p.interrupt) res();
          else if (this.now < at && id === this.runId) setTimeout(check, 200);
        };
        setTimeout(check, 200);
      }
    }).then(() => this.guard(id));
  }

  private tickTimers() {
    for (let i = this.timers.length - 1; i >= 0; i--)
      if (this.timers[i]!.at <= this.now) {
        this.timers[i]!.res();
        this.timers.splice(i, 1);
      }
  }

  private route(p: Person, loc: string, spot: string): Pt[] {
    const from = this.layout.places[p.loc] ?? this.layout.places[p.id]!, to = this.layout.places[loc]!;
    const end: Pt = spot === "seat" ? [to.seat![0], to.seat![1] + 14] : (to[spot] ?? to.visit);
    const pts: Pt[] = [[p.x, p.y]];
    if (p.loc !== loc) {
      const inside = (d: Pt): Pt => [d[0], d[1] + (d[1] < 500 ? -28 : 28)];
      if (from.door) pts.push(inside(from.door), from.door, [from.door[0], LANE]);
      else pts.push([p.x, LANE]);
      if (to.door) pts.push([to.door[0], LANE], to.door, inside(to.door));
      else pts.push([end[0], LANE]);
    }
    pts.push(end);
    return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) > 0.5);
  }

  private async walk(p: Person, loc: string, spot = "visit") {
    const id = this.runId;
    if (p.pose === "sit") {
      p.pose = "stand";
      p.typing = false;
      p.y += 14;
      await this.wait(250);
    }
    const pts = this.route(p, loc, spot);
    let len = 0;
    const segs: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      segs.push(l);
      len += l;
    }
    p.loc = loc;
    this.focus = p;
    if (len < 1) return;
    await new Promise<void>((res) => {
      p.moving = { pts, segs, len, t0: this.now, dur: Math.max(700, (len / SPEED) * 1000), res, last: 0 };
    });
    this.guard(id);
    p.back = false;
    p.face = 1;
  }

  private stepMove(p: Person) {
    const m = p.moving;
    if (!m) return;
    const u = clamp((this.now - m.t0) / m.dur, 0, 1), d = ease(u) * m.len;
    let acc = 0, i = 0;
    while (i < m.segs.length - 1 && acc + m.segs[i]! < d) acc += m.segs[i++]!;
    const a = m.pts[i]!, b = m.pts[i + 1]!, f = m.segs[i] ? (d - acc) / m.segs[i]! : 1;
    p.x = lerp(a[0], b[0], f);
    p.y = lerp(a[1], b[1], f);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    p.back = dy < -Math.abs(dx) * 0.6;
    if (Math.abs(dx) > 2) p.face = dx < 0 ? -1 : 1;
    p.phase += (d - m.last) / 7.5;
    m.last = d;
    if (u >= 1) {
      p.moving = null;
      m.res();
    }
  }

  private async sit(p: Person) {
    await this.walk(p, p.id, "seat");
    const s = this.layout.places[p.id]!.seat!;
    p.x = s[0];
    p.y = s[1];
    p.pose = "sit";
    p.back = true;
    const a = this.agents.get(p.id);
    p.typing = a?.state === "working";
  }

  private drawPerson(p: Person, t: number) {
    const k = p.parts, sit = p.pose === "sit", walking = !!p.moving;
    p.g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    k.stand!.setAttribute("display", sit ? "none" : "");
    k.back!.setAttribute("display", sit ? "" : "none");
    const back = sit || p.back;
    k.face!.setAttribute("display", back ? "none" : "");
    k.hb!.setAttribute("display", back ? "" : "none");
    k.parcel!.setAttribute("display", p.carry ? "" : "none");
    const sw = walking ? Math.sin(p.phase) * 26 : 0;
    k.legL!.setAttribute("transform", `rotate(${sw.toFixed(1)},-4.5,-21)`);
    k.legR!.setAttribute("transform", `rotate(${(-sw).toFixed(1)},4.5,-21)`);
    let aL = -sw * 0.8, aR = sw * 0.8;
    if (p.carry) aL = aR = 0;
    if (sit && p.typing) {
      aL = 8 + Math.sin(t * 22) * 6;
      aR = -8 - Math.sin(t * 22 + 1.7) * 6;
    }
    k.armL!.setAttribute("transform", `rotate(${aL.toFixed(1)},-13,-37)`);
    k.armR!.setAttribute("transform", `rotate(${aR.toFixed(1)},13,-37)`);
    const bob = walking ? -Math.abs(Math.cos(p.phase)) * 2 : Math.sin(t * 2 + p.x) * 0.6;
    k.up!.setAttribute("transform", `translate(0,${(sit ? 10 : 0) + bob})`);
    k.tag!.setAttribute("transform", `translate(0,${sit ? -72 : -82})`);
    k.body!.setAttribute("transform", p.face < 0 ? "scale(-1,1)" : "");
    const blink = (t + p.x * 0.01) % 4 < 0.12 ? 0.3 : 1;
    k.eL!.setAttribute("ry", String(1.6 * blink));
    k.eR!.setAttribute("ry", String(1.6 * blink));
    k.face!.setAttribute("transform", walking ? "translate(1.2,0)" : "");
  }

  private sortActors() {
    this.actors.sort((a, b) => a.base() - b.base());
    const order = this.actors.map((a) => a.base() | 0).join(",");
    if (order !== this.lastOrder) {
      this.lastOrder = order;
      this.actors.forEach((a) => this.lActors.appendChild(a.g));
    }
  }

  // ---------------------------------------------------------------- effects

  /** A speech bubble that stays until kill(). */
  private say(p: Person, text: string): Bubble {
    const w = Math.max(44, text.length * 6.4 + 24);
    const g = grp(this.lFx, `<g filter="url(#fSh)"><rect x="${-w / 2}" y="-30" width="${w}" height="26" rx="13" fill="#fff"/>
      <path d="M-6,-5 L0,4 L6,-5Z" fill="#fff"/></g>${T(0, -13, text, `text-anchor="middle" font-family="${SANS}" font-size="11.5" font-weight="500" fill="#2b2f3a"`)}`);
    const b: Bubble = { p, g, w, born: this.now, until: Infinity };
    this.focus = p;
    this.bubbles.push(b);
    return b;
  }

  /** A speech bubble for `ms`; resolves when it goes away. */
  private async sayFor(p: Person, text: string, ms: number) {
    const b = this.say(p, text);
    await this.wait(ms);
    this.kill(b);
  }

  private kill(b: Bubble) {
    b.until = Math.min(b.until, this.now);
  }

  private drawBubbles() {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!, p = b.p, age = this.now - b.born, out = this.now - b.until;
      if (out > 220 || p.hidden) {
        b.g.remove();
        this.bubbles.splice(i, 1);
        continue;
      }
      const s = out > 0 ? 1 - out / 220 : Math.min(1, age / 180), sc = 0.6 + 0.4 * ease(s);
      const x = clamp(p.x, b.w / 2 + 25, W - b.w / 2 - 25), y = p.y - (p.pose === "sit" ? 88 : 104) * (SCALE * 0.92);
      b.g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(3)})`);
      b.g.setAttribute("opacity", s.toFixed(2));
    }
  }

  private envelope(from: Pt, to: () => Pt, color: string, ms = 1500) {
    const g = grp(this.lFx, `<g filter="url(#fSh)"><rect x="-14" y="-10" width="28" height="20" rx="3" fill="#fff"/></g><path d="M-14,-9 L0,2 L14,-9" stroke="${color}" stroke-width="1.8" fill="none"/>`);
    return new Promise<void>((res) => this.flyers.push({ g, from, to, t0: this.now, ms, res })).then(() => g.remove());
  }

  private drawFlyers() {
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i]!, u = clamp((this.now - f.t0) / f.ms, 0, 1), e = ease(u), to = f.to();
      const x = lerp(f.from[0], to[0], e), y = lerp(f.from[1], to[1], e) - Math.sin(u * Math.PI) * 90;
      f.g.setAttribute("transform", `translate(${x},${y}) rotate(${Math.sin(u * Math.PI * 2) * 10}) scale(${1 + Math.sin(u * Math.PI) * 0.25})`);
      if (u >= 1) {
        this.flyers.splice(i, 1);
        f.res();
      }
    }
  }

  private celebrate(x: number, y: number) {
    const cols = ["#f0705d", "#e3a52f", "#22a48e", "#4f6bed", "#f3c36b", "#9db8ff"];
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 260 + Math.random() * 260;
      const n = i % 3 ? el("rect", { width: 7, height: 4, rx: 1, fill: cols[i % 6]! }, this.lFx) : el("circle", { r: 3, fill: cols[i % 6]! }, this.lFx);
      this.confetti.push({ n, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 360, vr: (Math.random() - 0.5) * 720, life: 1.6 + Math.random() * 0.6 });
    }
    const ring = el("circle", { cx: x, cy: y, r: 10, fill: "none", stroke: "#e3a52f", "stroke-width": 4 }, this.lFx);
    this.confetti.push({ ring, t0: this.now });
  }

  private drawConfetti(dt: number) {
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i]!;
      if ("ring" in c) {
        const u = (this.now - c.t0) / 700;
        c.ring.setAttribute("r", String(10 + u * 90));
        c.ring.setAttribute("opacity", String(Math.max(0, 1 - u)));
        if (u >= 1) {
          c.ring.remove();
          this.confetti.splice(i, 1);
        }
        continue;
      }
      c.vy += 620 * dt;
      c.vx *= 0.985;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.r += c.vr * dt;
      c.life -= dt;
      c.n.setAttribute("transform", `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${c.r.toFixed(0)})`);
      c.n.setAttribute("opacity", clamp(c.life * 2, 0, 1).toFixed(2));
      if (c.life <= 0) {
        c.n.remove();
        this.confetti.splice(i, 1);
      }
    }
  }

  private drawScreens(t: number) {
    for (const [key, s] of this.screens) {
      s.cur.setAttribute("opacity", (t * 2) % 1 < 0.5 && (s.typing || key === "ceo") ? "0.9" : "0");
      if (!s.typing) {
        s.cur.setAttribute("x", s.l1.getAttribute("x")!);
        continue;
      }
      const ws = [0.55, 0.3, 0.75].map((f, i) => 8 + ((t * (30 + i * 11) + i * 40) % 100) * f);
      let x = Number(s.l1.getAttribute("x"));
      s.cls.forEach((r, i) => {
        r.setAttribute("x", String(x));
        r.setAttribute("width", ws[i]!.toFixed(0));
        x += ws[i]! + 5;
      });
      s.cur.setAttribute("x", String(x));
    }
  }

  // ---------------------------------------------------------------- frame

  private frame = (ts: number) => {
    const dt = Math.min(0.05, (ts - (this.prev || ts)) / 1000);
    this.prev = ts;
    this.now += dt * 1000;
    const t = this.now / 1000;
    this.tickTimers();
    if (Math.floor(this.now / 1000) !== Math.floor((this.now - dt * 1000) / 1000)) this.checkIdle();
    for (const p of this.people.values()) {
      this.stepMove(p);
      if (!p.hidden) this.drawPerson(p, t);
    }
    if (this.autoCam && this.focus && this.vb.w < W) {
      // Keep the person clear of the Needs-you strip when it covers the top of the office.
      const strip = this.stage.querySelector("[role=alert]"), sr = this.stage.getBoundingClientRect();
      const inset = strip ? ((strip.getBoundingClientRect().bottom - sr.top) / Math.max(1, sr.height)) * this.vb.h : 0;
      const tx = this.focus.x - this.vb.w / 2, ty = this.focus.y - 60 - inset - (this.vb.h - inset) / 2, k = Math.min(1, dt * 1.6);
      this.vb.x = lerp(this.vb.x, tx, k);
      this.vb.y = lerp(this.vb.y, ty, k);
      this.applyVB();
    }
    this.sortActors();
    this.drawBubbles();
    this.drawFlyers();
    this.drawConfetti(dt);
    this.wall.step(dt);
    this.drawScreens(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- selection

  select(id: string | null) {
    this.selected = id;
    for (const p of this.people.values()) p.parts.ring!.setAttribute("opacity", p.id === id ? "0.9" : "0");
    const p = id ? this.people.get(id) : undefined;
    if (p) this.focus = p;
  }

  // ---------------------------------------------------------------- camera

  private applyVB() {
    const r = this.stage.getBoundingClientRect(), asp = r.height / Math.max(1, r.width), vb = this.vb;
    vb.w = clamp(vb.w, 360, this.fitW * 1.08);
    vb.h = vb.w * asp;
    const mx = 40;
    vb.x = vb.w > W + mx * 2 ? (W - vb.w) / 2 : clamp(vb.x, -mx, W + mx - vb.w);
    vb.y = vb.h > H + mx * 2 ? (H - vb.h) / 2 : clamp(vb.y, -mx, H + mx - vb.h);
    this.svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  fit = () => {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const asp = r.height / r.width, vb = this.vb;
    this.fitW = Math.max(W + 40, (H + 40) / asp);
    const narrow = r.width < 600;
    vb.w = narrow ? Math.min(this.fitW, 900) : this.fitW;
    vb.h = vb.w * asp;
    vb.x = narrow ? 10 : (W - vb.w) / 2;
    vb.y = (H - vb.h) / 2;
    this.autoCam = true;
    this.applyVB();
  };

  zoom(f: number) {
    const r = this.stage.getBoundingClientRect();
    this.autoCam = false;
    this.zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
  }

  private zoomAt(f: number, cx: number, cy: number) {
    const r = this.stage.getBoundingClientRect(), vb = this.vb;
    const wx = vb.x + ((cx - r.left) / r.width) * vb.w, wy = vb.y + ((cy - r.top) / r.height) * vb.h;
    const nw = clamp(vb.w * f, 360, this.fitW * 1.08), k = nw / vb.w;
    vb.x = wx - (wx - vb.x) * k;
    vb.y = wy - (wy - vb.y) * k;
    vb.w = nw;
    this.applyVB();
  }

  private bindPointer() {
    const stage = this.stage, ptrs = new Map<number, { x: number; y: number }>();
    let dragDist = 0, pinch0: number | null = null;
    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest("[data-hud]")) return;
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragDist = 0;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
      stage.classList.add("dragging");
    };
    const move = (e: PointerEvent) => {
      const last = ptrs.get(e.pointerId);
      if (!last) return;
      const r = stage.getBoundingClientRect();
      if (ptrs.size === 1) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        dragDist += Math.abs(dx) + Math.abs(dy);
        if (dragDist < 6) return;
        this.autoCam = false;
        this.vb.x -= (dx / r.width) * this.vb.w;
        this.vb.y -= (dy / r.height) * this.vb.h;
        this.applyVB();
      }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch0) this.zoomAt(pinch0 / d, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        pinch0 = d;
        dragDist = 99;
        this.autoCam = false;
      }
    };
    const up = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch0 = null;
      if (!ptrs.size) stage.classList.remove("dragging");
      if (e.type === "pointerup" && dragDist < 6 && !ptrs.size) {
        const hit = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest?.("[data-pick]")).find(Boolean) as Element | undefined;
        const v = hit?.getAttribute("data-pick") ?? "";
        const [kind, ...rest] = v.split(":");
        const id = rest.join(":");
        this.hooks.onPick(kind === "agent" ? { kind, id } : kind === "task" ? { kind, id } : kind === "ceo" ? { kind } : null);
      }
    };
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest("[data-hud]")) return;
      e.preventDefault();
      this.autoCam = false;
      this.zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    const over = (e: PointerEvent) => {
      const g = (e.target as Element).closest(".person");
      const id = g?.getAttribute("data-pick")?.slice(6);
      if (g && id !== this.selected) g.querySelector(".ring")?.setAttribute("opacity", "0.5");
    };
    const out = (e: PointerEvent) => {
      const g = (e.target as Element).closest(".person");
      const id = g?.getAttribute("data-pick")?.slice(6);
      if (g && id !== this.selected) g.querySelector(".ring")?.setAttribute("opacity", "0");
    };
    stage.addEventListener("pointerdown", down);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", wheel, { passive: false });
    this.svg.addEventListener("pointerover", over);
    this.svg.addEventListener("pointerout", out);
    this.cleanup.push(() => {
      stage.removeEventListener("pointerdown", down);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", up);
      stage.removeEventListener("wheel", wheel);
    });
  }
}

// ------------------------------------------------------------------ small helpers

export const signSymbol = (sign: string) => signOf(sign)?.symbol ?? "";

function pickReply(text: string) {
  if (/PR #\d+/.test(text) && /ready|review/i.test(text)) return "Nice, thanks";
  if (/yours|assign|task|WF-|[A-Z]{2,4}-\d/.test(text)) return "On it!";
  if (/\?$/.test(text)) return "Let me check";
  return "Got it";
}
