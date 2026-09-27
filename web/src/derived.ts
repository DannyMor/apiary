import { useMemo } from "react";
import { useApiary } from "./hooks";
import type { Session } from "./model";
import { buildSections, matchesFilter, type Section } from "./lib/sections";

/** Live sessions (not archived) that pass the filter. */
export function useShown(): Session[] {
  const sessions = useApiary((s) => s.sessions);
  const filter = useApiary((s) => s.filter);
  const groups = useApiary((s) => s.groups);
  const now = useApiary((s) => s.now);
  return useMemo(() => Object.values(sessions).filter((s) => s.status !== "archived" && matchesFilter(s, filter, groups, now)), [sessions, filter, groups, now]);
}
export function useSections(): Section[] {
  const shown = useShown();
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  const groupBy = useApiary((s) => s.groupBy);
  const sort = useApiary((s) => s.sort);
  const now = useApiary((s) => s.now);
  return useMemo(() => buildSections(shown, groups, groupOrder, groupBy, sort, now), [shown, groups, groupOrder, groupBy, sort, now]);
}
export function useCustomTags(): string[] {
  const sessions = useApiary((s) => s.sessions);
  return useMemo(() => [...new Set(Object.values(sessions).flatMap((s) => s.tags))].sort(), [sessions]);
}
export function useSelectedSessions(): Session[] {
  const sessions = useApiary((s) => s.sessions);
  const selected = useApiary((s) => s.selected);
  return useMemo(() => [...selected].map((id) => sessions[id]).filter((s): s is Session => !!s && s.status !== "archived"), [sessions, selected]);
}
