import { createStore, type StoreApi } from "zustand/vanilla";
import type { ApiClient } from "./api/client";
import type { ApiEvent, ApplyReport, Decision, GroupOut, SessionOut, Settings } from "./api/types";
import { groupFromApi, sessionFromApi, type GroupUI, type Session } from "./model";
import type { Lens } from "./lib/layout";
import { emptyFilter, type Filter, type GroupBy, type SortKey } from "./lib/sections";

export type Dialog =
  | { kind: "swarm"; gid: string | null }
  | { kind: "labels" }
  | { kind: "world" }
  | { kind: "honey"; id: string }
  | { kind: "purge"; id: string }
  | { kind: "summarize"; id: string }
  | { kind: "color"; gid: string };

export type CameraRequest = { kind: "session"; id: string } | { kind: "group"; gid: string } | { kind: "overview" } | { kind: "top" };

export interface ApiaryState {
  sessions: Record<string, Session>;
  groups: Record<string, GroupUI>;
  groupOrder: string[];
  conn: "connecting" | "live" | "offline";
  loadError: string | null;
  now: number;
  tab: "sessions" | "gc"; lens: Lens; sort: SortKey; groupBy: GroupBy; filter: Filter; filterOpen: boolean;
  threshold: number; world: string; collapsed: Record<string, boolean>;
  selected: Set<string>; focusGroup: string | null; focusSession: string | null; hover: string | null;
  toast: string | null; dialog: Dialog | null; keeperBusy: boolean;
  camera: { seq: number; req: CameraRequest | null }; cameraTarget: { x: number; z: number };

  load(): Promise<void>;
  applyEvent(ev: ApiEvent): void;
  refreshSessions(ids: string[]): Promise<void>;
  select(id: string, additive: boolean): void;
  clearSelection(): void;
  setHover(id: string | null): void;
  setFocus(group: string | null, session: string | null, target?: { x: number; z: number }): void;
  requestCamera(req: CameraRequest): void;
  setTab(tab: "sessions" | "gc"): void;
  setLens(lens: Lens): void;
  setSort(sort: SortKey): void;
  setGroupBy(groupBy: GroupBy): void;
  setFilter(patch: Partial<Filter>): void;
  resetFilter(): void;
  setFilterOpen(open: boolean): void;
  toggleCollapsed(id: string): void;
  setThreshold(n: number, persist: boolean): void;
  setWorld(hex: string): void;
  showToast(msg: string): void;
  openDialog(d: Dialog): void;
  closeDialog(): void;
  createSwarm(name: string, color: string | null, memberIds: string[]): Promise<string>;
  updateGroup(gid: string, patch: { name?: string; color?: string }): Promise<void>;
  deleteGroup(gid: string): Promise<void>;
  addMembers(gid: string, ids: string[]): Promise<void>;
  removeMember(gid: string, id: string): Promise<void>;
  returnHome(ids: string[]): Promise<void>;
  addTag(id: string, tag: string): Promise<void>;
  removeTag(id: string, tag: string): Promise<void>;
  decide(id: string, decision: Decision | null): Promise<void>;
  applyMarks(): Promise<ApplyReport>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  honey(id: string): Promise<string>;
}
export type ApiaryStore = StoreApi<ApiaryState>;

const SETTINGS_DEBOUNCE_MS = 300;

export function createApiaryStore(api: ApiClient): ApiaryStore {
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let settingsPatch: Settings = {};
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;

  const store = createStore<ApiaryState>((set, get) => {
    const orderGroups = (groups: Record<string, GroupUI>) =>
      Object.keys(groups).sort((a, b) => {
        const A = groups[a], B = groups[b];
        return A.kind !== B.kind ? (A.kind === "repo" ? -1 : 1) : A.name.localeCompare(B.name);
      });
    const upsertGroup = (g: GroupOut) =>
      set((st) => {
        const groups = { ...st.groups, [g.id]: groupFromApi(g) };
        return { groups, groupOrder: orderGroups(groups) };
      });
    const removeGroup = (gid: string) =>
      set((st) => {
        const groups = { ...st.groups }; delete groups[gid];
        const sessions = Object.fromEntries(Object.entries(st.sessions).map(([id, s]) => [id, s.swarms.includes(gid) ? { ...s, swarms: s.swarms.filter((x) => x !== gid) } : s]));
        const filter = { ...st.filter, groups: new Set([...st.filter.groups].filter((x) => x !== gid)) };
        return { groups, groupOrder: orderGroups(groups), sessions, filter, focusGroup: st.focusGroup === gid ? null : st.focusGroup };
      });
    const removeSession = (id: string) =>
      set((st) => {
        const sessions = { ...st.sessions }; delete sessions[id];
        const selected = new Set(st.selected); selected.delete(id);
        return { sessions, selected, focusSession: st.focusSession === id ? null : st.focusSession, hover: st.hover === id ? null : st.hover };
      });
    const upsertSession = (a: SessionOut) => {
      if (a.status === "purged") { removeSession(a.id); return; }
      const s = sessionFromApi(a);
      set((st) => {
        const groups = st.groups[s.repo] ? st.groups : { ...st.groups, [s.repo]: groupFromApi({ id: s.repo, name: a.repo_name, kind: "repo", color: null, member_ids: [] }) };
        return { sessions: { ...st.sessions, [a.id]: s }, groups, groupOrder: groups === st.groups ? st.groupOrder : orderGroups(groups) };
      });
    };
    const applySettings = (s: Settings) =>
      set((st) => ({
        world: typeof s.world === "string" ? s.world : st.world,
        collapsed: s.collapsed && typeof s.collapsed === "object" ? (s.collapsed as Record<string, boolean>) : st.collapsed,
        threshold: typeof s.threshold === "number" ? s.threshold : st.threshold,
      }));
    const persist = (patch: Settings) => {
      Object.assign(settingsPatch, patch);
      if (settingsTimer) clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => {
        const body = settingsPatch; settingsPatch = {};
        api.putSettings(body).catch((err) => get().showToast(String(err.message ?? err)));
      }, SETTINGS_DEBOUNCE_MS);
    };
    const guarded = async <T,>(work: () => Promise<T>): Promise<T> => {
      try { return await work(); } catch (err) { get().showToast(String((err as Error).message ?? err)); throw err; }
    };

    return {
      sessions: {}, groups: {}, groupOrder: [], conn: "connecting", loadError: null, now: Date.now(),
      tab: "sessions", lens: "recency", sort: "lastActive", groupBy: "group", filter: emptyFilter(), filterOpen: false,
      threshold: 35, world: "#f4f6f8", collapsed: {},
      selected: new Set(), focusGroup: null, focusSession: null, hover: null,
      toast: null, dialog: null, keeperBusy: false,
      camera: { seq: 0, req: null }, cameraTarget: { x: 0, z: 0 },

      async load() {
        try {
          const [sessions, groups, settings] = await Promise.all([api.sessions(), api.groups(), api.settings()]);
          set({ sessions: {}, groups: {}, groupOrder: [], loadError: null, now: Date.now() });
          for (const g of groups) upsertGroup(g);
          for (const s of sessions) upsertSession(s);
          applySettings(settings);
        } catch (err) {
          set({ loadError: String((err as Error).message ?? err), conn: "offline" });
          return;
        }
        if (!connected) {
          connected = true;
          api.events((ev) => get().applyEvent(ev), (status) => set({ conn: status }));
        }
      },
      applyEvent(ev) {
        if (ev.type === "session.updated") upsertSession(ev.session);
        else if (ev.type === "session.live") set((st) => (st.sessions[ev.id] ? { sessions: { ...st.sessions, [ev.id]: { ...st.sessions[ev.id], active: ev.live } } } : {}));
        else if (ev.type === "group.updated") upsertGroup(ev.group);
        else if (ev.type === "group.deleted") removeGroup(ev.id);
        else if (ev.type === "settings.updated") applySettings(ev.settings);
        set({ now: Date.now() });
      },
      async refreshSessions(ids) {
        await Promise.all([...new Set(ids)].map(async (id) => {
          try { upsertSession(await api.session(id)); } catch { removeSession(id); }
        }));
      },
      select(id, additive) {
        set((st) => {
          if (!additive) return { selected: new Set([id]) };
          const selected = new Set(st.selected);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          return { selected };
        });
      },
      clearSelection() { set({ selected: new Set() }); },
      setHover(id) { if (get().hover !== id) set({ hover: id }); },
      setFocus(group, session, target) { set((st) => ({ focusGroup: group, focusSession: session, cameraTarget: target ?? st.cameraTarget })); },
      requestCamera(req) { set((st) => ({ camera: { seq: st.camera.seq + 1, req } })); },
      setTab(tab) { set(tab === "gc" ? { tab, lens: "score" } : { tab }); },
      setLens(lens) { set({ lens }); },
      setSort(sort) { set({ sort }); },
      setGroupBy(groupBy) { set({ groupBy }); },
      setFilter(patch) { set((st) => ({ filter: { ...st.filter, ...patch } })); },
      resetFilter() { set({ filter: emptyFilter() }); },
      setFilterOpen(open) { set({ filterOpen: open }); },
      toggleCollapsed(id) {
        const collapsed = { ...get().collapsed, [id]: !get().collapsed[id] };
        set({ collapsed });
        persist({ collapsed });
      },
      setThreshold(n, persistIt) { set({ threshold: n }); if (persistIt) persist({ threshold: n }); },
      setWorld(hex) { set({ world: hex }); persist({ world: hex }); },
      showToast(msg) {
        set({ toast: msg });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: null }), 2200);
      },
      openDialog(d) { set({ dialog: d }); },
      closeDialog() { set({ dialog: null }); },

      createSwarm: (name, color, memberIds) => guarded(async () => {
        const g = await api.createGroup({ name, color, member_ids: memberIds });
        upsertGroup(g);
        await get().refreshSessions(memberIds);
        return g.id;
      }),
      updateGroup: (gid, patch) => guarded(async () => { upsertGroup(await api.patchGroup(gid, patch)); }),
      deleteGroup: (gid) => guarded(async () => {
        const members = Object.values(get().sessions).filter((s) => s.swarms.includes(gid)).map((s) => s.id);
        await api.deleteGroup(gid);
        removeGroup(gid);
        await get().refreshSessions(members);
      }),
      addMembers: (gid, ids) => guarded(async () => { upsertGroup(await api.addMembers(gid, ids)); await get().refreshSessions(ids); }),
      removeMember: (gid, id) => guarded(async () => { upsertGroup(await api.removeMember(gid, id)); await get().refreshSessions([id]); }),
      returnHome: (ids) => guarded(async () => {
        for (const id of ids) for (const gid of get().sessions[id]?.swarms ?? []) upsertGroup(await api.removeMember(gid, id));
        await get().refreshSessions(ids);
      }),
      addTag: (id, tag) => guarded(async () => { upsertSession(await api.addTag(id, tag)); }),
      removeTag: (id, tag) => guarded(async () => { upsertSession(await api.removeTag(id, tag)); }),
      decide: (id, decision) => guarded(async () => { upsertSession(await (decision ? api.decide(id, decision) : api.undecide(id))); }),
      applyMarks: () => guarded(async () => {
        set({ keeperBusy: true });
        try {
          const r = await api.apply();
          await get().refreshSessions([...r.archived, ...r.failed.map((f) => f.session_id)]);
          return r;
        } finally { set({ keeperBusy: false }); }
      }),
      restore: (id) => guarded(async () => { upsertSession(await api.restore(id)); }),
      purge: (id) => guarded(async () => { await api.purge([id]); await get().refreshSessions([id]); }),
      honey: (id) => guarded(() => api.honey(id)),
    };
  });
  return store;
}
