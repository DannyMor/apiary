export const HEX_SPACING = 1.08; // axial size of a session cell
export const HEX_R = 0.92; // drawn circumradius
export const REGION_SIZE = 10.5; // axial size of a region cell

export interface Axial { q: number; r: number }
export interface XZ { x: number; z: number }

export const axialToWorld = (q: number, r: number, size: number): XZ => ({ x: size * Math.sqrt(3) * (q + r / 2), z: size * 1.5 * r });

/** The first n cells of a hex spiral from the origin. */
export function spiral(n: number): Axial[] {
  const out: Axial[] = [{ q: 0, r: 0 }];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let k = 1; out.length < n; k++) {
    let q = -k, r = k;
    for (let d = 0; d < 6 && out.length < n; d++) {
      for (let i = 0; i < k && out.length < n; i++) { out.push({ q, r }); q += dirs[d][0]; r += dirs[d][1]; }
    }
  }
  return out;
}
export function ringCount(n: number): number {
  let k = 0, t = 1;
  while (t < n) { k++; t += 6 * k; }
  return k;
}
