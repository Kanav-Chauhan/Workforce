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
  simha: L("#e3a52f", "#c98b1c", "#3b2a20", "#e2b48c", "short", "#3f4a5f"),
  mesha: L("#f0705d", "#d85a48", "#2a1d1a", "#f0c7a4", "long", "#38425a"),
  kanya: L("#22a48e", "#178a76", "#5a3424", "#c99470", "bun"),
  makara: L("#5b7bb8", "#4766a3", "#2b2420", "#d9a882", "short"),
  tula: L("#9b7bd8", "#8263c4", "#3a2418", "#f0c7a4", "long"),
  vrishchika: L("#b2475e", "#983a4f", "#1f1a1a", "#c99470", "short"),
  vrishabha: L("#6c9a4a", "#587f3b", "#4a3020", "#e2b48c", "bun"),
  mithuna: L("#e58a3c", "#cc742a", "#2a1d1a", "#c99470", "long"),
  karka: L("#5fb3c9", "#469cb3", "#5a3424", "#f0c7a4", "short"),
  dhanu: L("#d4608f", "#bd4b7a", "#2b2420", "#d9a882", "bun"),
  kumbha: L("#4f6bed", "#3f59d4", "#3b2a20", "#c99470", "short"),
  meena: L("#3fae9e", "#2f9284", "#1f1a1a", "#e2b48c", "long"),
};

export const lookOf = (sign: string): Look => LOOKS[sign] ?? LOOKS.kumbha!;
