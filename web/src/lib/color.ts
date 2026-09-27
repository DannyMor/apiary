// OKLCH the way the prototype and colors.py do it: "l c h" strings on the wire, {l,c,h} in the UI.
export interface Oklch { l: number; c: number; h: number }
export type Rgb = [number, number, number];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function oklchToLinear(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.002 && v <= 1.002);

/** Pull chroma in until the color fits sRGB. */
export function gamutMap(col: Oklch): Rgb {
  let c = col.c;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToLinear(col.l, c, col.h);
    if (inGamut(rgb)) return rgb.map((v) => clamp(v, 0, 1)) as Rgb;
    c *= 0.9;
  }
  return oklchToLinear(col.l, 0, col.h).map((v) => clamp(v, 0, 1)) as Rgb;
}
export const lin2srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export function cssOf(col: Oklch): string {
  const [r, g, b] = gamutMap(col).map(lin2srgb);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
export function deltaE(c1: Oklch, c2: Oklch): number {
  const lab = (c: Oklch) => [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)];
  const a = lab(c1), b = lab(c2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}
/** Recency-driven shade: chroma collapses toward grey and lightness sinks as sessions age. */
export function shadeOf(base: Oklch, rec: number, active: boolean): Oklch {
  const r = active ? 1 : rec, t = Math.pow(r, 1.35);
  return { l: 0.5 + (base.l - 0.5) * (0.1 + 0.9 * t) + (active ? 0.08 : 0), c: base.c * (0.03 + 0.97 * t), h: base.h };
}

export const AVOID_HUES = [88, 104, 120]; // olive/mustard band: counts as taken, never suggested
const PALETTE_HUES = [22, 152, 262, 322];
export function suggestColors(existing: Oklch[], n: number): Oklch[] {
  if (!existing.length) return PALETTE_HUES.slice(0, n).map((h) => ({ l: 0.64, c: 0.21, h }));
  const hues = existing.map((c) => c.h).concat(AVOID_HUES);
  const out: Oklch[] = [];
  while (out.length < n) {
    hues.sort((a, b) => a - b);
    let best = -1, bi = 0;
    for (let i = 0; i < hues.length; i++) {
      const a = hues[i], b = i + 1 < hues.length ? hues[i + 1] : hues[0] + 360;
      if (b - a > best) { best = b - a; bi = i; }
    }
    const mid = (hues[bi] + best / 2) % 360;
    out.push({ l: 0.64, c: 0.21, h: mid });
    hues.push(mid);
  }
  return out;
}

export function parseColor(str: string | null | undefined): Oklch {
  const [l, c, h] = String(str || "0.64 0.21 22").split(/\s+/).map(Number);
  return { l, c, h };
}
export const fmtColor = (col: Oklch) => `${col.l.toFixed(2)} ${col.c.toFixed(2)} ${Math.round(col.h * 100) / 100}`;
