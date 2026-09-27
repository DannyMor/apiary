import type { GroupUI, Session } from "../model";
import { HEX_SPACING, REGION_SIZE, axialToWorld, ringCount, spiral, type XZ } from "./hex";
import { displayGroupOf } from "./sections";
import { recencyOf } from "./time";

export type Lens = "recency" | "score";
export interface Layout {
  centers: Map<string, XZ>; pos: Map<string, XZ>; ghostPos: Map<string, XZ>; displayGroup: Map<string, string>;
  count: Map<string, number>; maxH: Map<string, number>; radius: Map<string, number>;
}

export function heightFor(s: Session, lens: Lens, now: number): number {
  if (lens === "score") return 0.35 + 6.2 * (s.score / 100);
  const rec = s.active ? 1 : recencyOf(s.lastActiveAt, now);
  return 0.35 + 6.2 * Math.pow(rec, 1.6);
}

/** Where every hive, swarm and cell sits. A hive with nothing kept leaves the world. */
export function computeLayout(sessions: Session[], groups: Record<string, GroupUI>, groupOrder: string[], lens: Lens, now: number): Layout {
  const live = sessions.filter((s) => s.status !== "archived");
  const shown = groupOrder.filter((gid) => groups[gid] && (groups[gid].kind === "custom" || live.some((s) => s.repo === gid)));
  const lay: Layout = { centers: new Map(), pos: new Map(), ghostPos: new Map(), displayGroup: new Map(), count: new Map(), maxH: new Map(), radius: new Map() };
  const coords = spiral(shown.length);
  shown.forEach((gid, i) => lay.centers.set(gid, axialToWorld(coords[i].q, coords[i].r, REGION_SIZE)));
  for (const s of live) lay.displayGroup.set(s.id, displayGroupOf(s, shown, groups));
  for (const gid of shown) {
    const c = lay.centers.get(gid)!;
    const own = live.filter((s) => lay.displayGroup.get(s.id) === gid).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const ghosts = groups[gid].kind === "repo" ? live.filter((s) => s.repo === gid && lay.displayGroup.get(s.id) !== gid) : [];
    const all = own.concat(ghosts), cells = spiral(all.length);
    all.forEach((s, i) => {
      const p = axialToWorld(cells[i].q, cells[i].r, HEX_SPACING), at = { x: c.x + p.x, z: c.z + p.z };
      if (i < own.length) lay.pos.set(s.id, at); else lay.ghostPos.set(s.id, at);
    });
    lay.count.set(gid, own.length);
    lay.maxH.set(gid, own.reduce((m, s) => Math.max(m, heightFor(s, lens, now)), 0.4));
    lay.radius.set(gid, (ringCount(all.length) + 0.8) * HEX_SPACING * Math.sqrt(3));
  }
  return lay;
}
