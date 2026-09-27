import type { GroupUI, Session } from "../model";
import { DATE_BUCKETS, DAY, dateBucket } from "./time";

export interface Filter { q: string; groups: Set<string>; scoreMin: number; scoreMax: number; within: number; kinds: Set<string> }
export const emptyFilter = (): Filter => ({ q: "", groups: new Set(), scoreMin: 0, scoreMax: 100, within: 0, kinds: new Set() });
export const filterActive = (f: Filter) => !!(f.q || f.groups.size || f.scoreMin > 0 || f.scoreMax < 100 || f.within || f.kinds.size);

// labels: a few derived from the session itself, plus whatever the person attaches
export const AUTO_TAGS: Record<string, (s: Session) => boolean> = {
  running: (s) => s.active, fork: (s) => !!s.parentId, review: (s) => /^Review PR/.test(s.title), edits: (s) => s.filesEdited > 0,
};
export const AUTO_NAMES: Record<string, string> = { running: "Running", fork: "Fork", review: "Review", edits: "Edited files" };
export const autoTagsOf = (s: Session) => Object.keys(AUTO_TAGS).filter((k) => AUTO_TAGS[k](s));
export const tagsOf = (s: Session) => autoTagsOf(s).concat(s.tags);

export const displayGroupOf = (s: Session, groupOrder: string[], groups: Record<string, GroupUI>) =>
  groupOrder.find((g) => groups[g] && s.swarms.includes(g)) ?? s.repo;

export function matchesFilter(s: Session, f: Filter, groups: Record<string, GroupUI>, now: number): boolean {
  if (f.q) {
    const q = f.q.toLowerCase(), hive = groups[s.repo]?.name.toLowerCase() ?? "";
    if (!s.title.toLowerCase().includes(q) && !hive.includes(q)) return false;
  }
  if (f.groups.size && !f.groups.has(s.repo) && !s.swarms.some((g) => f.groups.has(g))) return false;
  if (s.score < f.scoreMin || s.score > f.scoreMax) return false;
  if (f.within && now - s.lastActiveAt > f.within * DAY) return false;
  if (f.kinds.size && !tagsOf(s).some((t) => f.kinds.has(t))) return false;
  return true;
}

export type GroupBy = "group" | "date" | "score" | "none";
export type SortKey = "lastActive" | "created" | "score" | "name";
export const ORDERS: Record<SortKey, (a: Session, b: Session) => number> = {
  lastActive: (a, b) => b.lastActiveAt - a.lastActiveAt,
  created: (a, b) => b.createdAt - a.createdAt,
  score: (a, b) => b.score - a.score,
  name: (a, b) => a.title.localeCompare(b.title),
};
export interface Section { id: string; key: string; title: string; rows: Session[]; ghosts: Session[] }

/** Tray sections for the sessions given (already filtered to what is shown). */
export function buildSections(
  sessions: Session[], groups: Record<string, GroupUI>, groupOrder: string[], groupBy: GroupBy, sort: SortKey, now: number,
): Section[] {
  const cmp = ORDERS[sort];
  if (groupBy === "none") return [{ id: "all", key: "all", title: "", rows: sessions.slice().sort(cmp), ghosts: [] }];
  const keyOf = (s: Session): string =>
    groupBy === "date" ? String(dateBucket(s.lastActiveAt, now))
    : groupBy === "score" ? String(Math.min(9, Math.floor(s.score / 10)))
    : displayGroupOf(s, groupOrder, groups);
  const titleOf = (k: string) =>
    groupBy === "date" ? DATE_BUCKETS[+k] : groupBy === "score" ? (k === "9" ? "90–100" : `${+k * 10}–${+k * 10 + 9}`) : groups[k]?.name ?? k;
  const order = (a: string, b: string) =>
    groupBy === "date" ? +a - +b : groupBy === "score" ? +b - +a : (groups[a]?.name ?? a).localeCompare(groups[b]?.name ?? b);
  const byKey = new Map<string, Session[]>();
  for (const s of sessions) { const k = keyOf(s); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s); }
  // empty swarms still show; a hive shows while any of its cells are on loan (they appear as ghosts)
  if (groupBy === "group") {
    for (const gid of groupOrder) {
      if (!byKey.has(gid) && (groups[gid]?.kind === "custom" || sessions.some((s) => s.repo === gid))) byKey.set(gid, []);
    }
  }
  return [...byKey.keys()].sort(order).map((k) => ({
    id: `${groupBy}:${k}`, key: k, title: titleOf(k), rows: byKey.get(k)!.slice().sort(cmp),
    ghosts: groupBy !== "group" ? [] : (
      groups[k]?.kind === "repo"
        ? sessions.filter((s) => s.repo === k && displayGroupOf(s, groupOrder, groups) !== k)
        : sessions.filter((s) => s.swarms.includes(k) && displayGroupOf(s, groupOrder, groups) !== k)
    ).sort(cmp),
  }));
}
