// Where everything sits in the office (a 1600 × 1000 drawing). The CEO and the lead have cabins on the top row
// next to the plan wall and review gate; workers share the bottom row with the lounge, which takes what is left.

export const W = 1600;
export const H = 1000;
export const LANE = 515; // the corridor people walk along

export type Pt = [number, number];
export type Row = "top" | "bot";

export interface Cabin {
  key: string; // "ceo" or an agent id
  x: number;
  w: number;
  row: Row;
  door: number;
  desk: number; // desk centre x
  deskW: number;
  monW: number;
  label: string;
  color: string;
}

export const ROWS = {
  top: { glass: 420, mon: 96, desk: 158, seat: 264, visitY: 300 },
  bot: { glass: 610, mon: 634, desk: 696, seat: 802, visitY: 842 },
} as const;

export interface Place {
  door?: Pt;
  seat?: Pt;
  visit: Pt;
  [spot: string]: Pt | undefined;
}

export interface Layout {
  cabins: Cabin[];
  places: Record<string, Place>;
  lounge: { x: number; w: number; sofa: boolean };
  walls: { top: number[]; bot: number[] };
}

export interface Member {
  id: string;
  label: string;
  color: string;
  isLead: boolean;
}

export function layoutFor(team: Member[]): Layout {
  const lead = team.find((m) => m.isLead);
  const workers = team.filter((m) => m !== lead).slice(0, 6);
  const cabins: Cabin[] = [
    { key: "ceo", x: 40, w: 440, row: "top", door: 420, desk: 250, deskW: 250, monW: 190, label: "You (CEO)", color: "#4f6bed" },
  ];
  if (lead) cabins.push({ key: lead.id, x: 500, w: 300, row: "top", door: 560, desk: 660, deskW: 200, monW: 172, label: lead.label, color: lead.color });
  const n = workers.length;
  const ww = n <= 3 ? 320 : Math.floor(1060 / n) - 20;
  workers.forEach((m, i) => {
    const x = 40 + i * (ww + 20);
    cabins.push({
      key: m.id,
      x,
      w: ww,
      row: "bot",
      door: x + 52,
      desk: x + Math.round(ww * 0.55),
      deskW: Math.min(200, ww - 70),
      monW: Math.min(172, ww - 80),
      label: m.label,
      color: m.color,
    });
  });
  const loungeX = n ? 40 + n * (ww + 20) : 40;
  const lw = 1580 - loungeX;
  const places: Record<string, Place> = {};
  for (const c of cabins) {
    const r = ROWS[c.row];
    places[c.key] = {
      door: [c.door, r.glass],
      seat: [c.desk, r.seat],
      visit: [c.desk + Math.min(102, c.w / 2 - 30), r.visitY],
    };
  }
  // The CEO cabin has room for several people waiting on you.
  places.ceo = { ...places.ceo!, seat: undefined, visit: [345, 300], s0: [345, 300], s1: [300, 345], s2: [395, 345], s3: [345, 380] };
  places.plan = { visit: [1020, 372] };
  places.gate = { visit: [1505, 420] };
  places.lounge = {
    visit: [loungeX + lw / 2, 720],
    coffee: [1430, 872],
    w1: [loungeX + lw * 0.3, 690],
    w2: [loungeX + lw * 0.62, 800],
    w3: [loungeX + lw * 0.45, 868],
    sofa: [loungeX + 135, 840],
  };
  return {
    cabins,
    places,
    lounge: { x: loungeX, w: lw, sofa: lw >= 620 },
    walls: { top: [490, 810], bot: [...workers.map((_, i) => 40 + i * (ww + 20) + ww + 10)] },
  };
}
