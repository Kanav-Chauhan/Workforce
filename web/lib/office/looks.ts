// How each team member looks in the office: one colour per sign, plus hair and skin.

export interface Look {
  shirt: string;
  shirt2: string;
  hair: string;
  skin: string;
  style: "short" | "long" | "bun";
  pants: string;
}

const L = (shirt: string, shirt2: string, hair: string, skin: string, style: Look["style"], pants = "#3a4558"): Look => ({ shirt, shirt2, hair, skin, style, pants });

export const LOOKS: Record<string, Look> = {
  leo: L("#e3a52f", "#c98b1c", "#3b2a20", "#e2b48c", "short", "#3f4a5f"),
  aries: L("#f0705d", "#d85a48", "#2a1d1a", "#f0c7a4", "long", "#38425a"),
  virgo: L("#22a48e", "#178a76", "#5a3424", "#c99470", "bun"),
  capricorn: L("#5b7bb8", "#4766a3", "#2b2420", "#d9a882", "short"),
  libra: L("#9b7bd8", "#8263c4", "#3a2418", "#f0c7a4", "long"),
  scorpio: L("#b2475e", "#983a4f", "#1f1a1a", "#c99470", "short"),
  taurus: L("#6c9a4a", "#587f3b", "#4a3020", "#e2b48c", "bun"),
  gemini: L("#e58a3c", "#cc742a", "#2a1d1a", "#c99470", "long"),
  cancer: L("#5fb3c9", "#469cb3", "#5a3424", "#f0c7a4", "short"),
  sagittarius: L("#d4608f", "#bd4b7a", "#2b2420", "#d9a882", "bun"),
  aquarius: L("#4f6bed", "#3f59d4", "#3b2a20", "#c99470", "short"),
  pisces: L("#3fae9e", "#2f9284", "#1f1a1a", "#e2b48c", "long"),
};

export const lookOf = (sign: string): Look => LOOKS[sign] ?? LOOKS.aquarius!;

/** A look for any agent: its sign's, or one made from a custom agent's own colour. */
export function lookFor(a: { sign: string; color?: string; name?: string }): Look {
  if (!a.color || !/^#[0-9a-f]{6}$/i.test(a.color)) return lookOf(a.sign);
  const base = LOOKS[Object.keys(LOOKS)[hash(a.name || a.sign) % 12]!]!;
  return { ...base, shirt: a.color, shirt2: shade(a.color, 0.85) };
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
