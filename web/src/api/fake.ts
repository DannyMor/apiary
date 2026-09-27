import type { ApiClient, EventHandler, StatusHandler } from "./client";
import type { ApiEvent, ApplyReport, Decision, GroupOut, SessionOut, Settings } from "./types";

/** An in-memory daemon: enough of the API's behavior for the UI and its tests, no network. */
export class FakeApi implements ApiClient {
  sessionsById = new Map<string, SessionOut>();
  groupsById = new Map<string, GroupOut>();
  stored: Settings = {};
  honeyText = new Map<string, string>();
  calls: string[] = [];
  private handler: EventHandler | null = null;
  private status: StatusHandler | null = null;
  private nextId = 1;

  constructor(sessions: SessionOut[] = [], groups: GroupOut[] = []) {
    for (const s of sessions) this.sessionsById.set(s.id, s);
    for (const g of groups) this.groupsById.set(g.id, g);
  }
  emit(ev: ApiEvent) { this.handler?.(ev); }
  setStatus(s: "live" | "offline") { this.status?.(s); }

  async sessions() { return [...this.sessionsById.values()].filter((s) => s.status !== "purged"); }
  async session(id: string) { return this.must(id); }
  async groups() { return [...this.groupsById.values()]; }
  async settings() { return { ...this.stored }; }
  async putSettings(patch: Settings) {
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete this.stored[k]; else this.stored[k] = v; }
    this.calls.push("putSettings");
    return { ...this.stored };
  }
  async createGroup(body: { name: string; color?: string | null; member_ids: string[] }) {
    const id = `swarm:fake${this.nextId++}`;
    const g: GroupOut = { id, name: body.name, kind: "custom", color: body.color ?? "0.64 0.21 283.75", member_ids: [...body.member_ids].sort() };
    this.groupsById.set(id, g);
    for (const sid of body.member_ids) this.must(sid).groups = [...this.must(sid).groups, id].sort();
    return g;
  }
  async patchGroup(id: string, body: { name?: string | null; color?: string | null }) {
    const g = this.groupsById.get(id); if (!g) throw new Error(`no such id: ${id}`);
    if (body.name) g.name = body.name; if (body.color) g.color = body.color;
    return g;
  }
  async deleteGroup(id: string) {
    this.groupsById.delete(id);
    for (const s of this.sessionsById.values()) s.groups = s.groups.filter((x) => x !== id);
  }
  async addMembers(id: string, ids: string[]) {
    const g = this.groupsById.get(id)!;
    g.member_ids = [...new Set([...g.member_ids, ...ids])].sort();
    for (const sid of ids) this.must(sid).groups = [...new Set([...this.must(sid).groups, id])].sort();
    return g;
  }
  async removeMember(id: string, sid: string) {
    const g = this.groupsById.get(id)!;
    g.member_ids = g.member_ids.filter((x) => x !== sid);
    this.must(sid).groups = this.must(sid).groups.filter((x) => x !== id);
    return g;
  }
  async addTag(id: string, tag: string) { const s = this.must(id); s.tags = [...new Set([...s.tags, tag])].sort(); return s; }
  async removeTag(id: string, tag: string) { const s = this.must(id); s.tags = s.tags.filter((t) => t !== tag); return s; }
  async decide(id: string, decision: Decision) { const s = this.must(id); s.decision = decision; return s; }
  async undecide(id: string) { const s = this.must(id); s.decision = null; return s; }
  async apply(): Promise<ApplyReport> {
    const report: ApplyReport = { archived: [], summarized: [], failed: [] };
    for (const s of this.sessionsById.values()) {
      if (s.decision === "archive" || s.decision === "summarize_archive") {
        if (s.decision === "summarize_archive") { s.has_honey = true; this.honeyText.set(s.id, `# ${s.title}\n\nfake honey`); report.summarized.push(s.id); }
        s.status = "archived"; report.archived.push(s.id);
      }
    }
    return report;
  }
  async restore(id: string) { const s = this.must(id); s.status = "idle"; s.decision = null; return s; }
  async purge(ids: string[]) { for (const id of ids) this.must(id).status = "purged"; return { purged: ids }; }
  async honey(id: string) { const t = this.honeyText.get(id); if (t === undefined) throw new Error("no honey"); return t; }
  async suggestColors(n: number) { return Array.from({ length: n }, (_, i) => `0.64 0.21 ${(40 + i * 70) % 360}`); }
  events(onEvent: EventHandler, onStatus: StatusHandler) { this.handler = onEvent; this.status = onStatus; onStatus("live"); return () => { this.handler = null; }; }

  private must(id: string) { const s = this.sessionsById.get(id); if (!s) throw new Error(`no such id: ${id}`); return s; }
}

export function fakeSessionOut(patch: Partial<SessionOut> & { id: string }): SessionOut {
  return {
    repo_path: "/u/src/a", repo_name: "a", branch: "main", title: patch.id, created_at: 1_700_000_000, last_active_at: 1_700_000_000,
    mtime: 0, size_bytes: 1, msg_count: 4, tool_calls: 1, files_edited: 0, parent_id: null, status: "idle", transcript: "/x",
    worktree: null, score: 50, reasons: [], tags: [], groups: ["repo:a"], decision: null, has_honey: false, ...patch,
  };
}
export const fakeGroupOut = (id: string, name: string, kind: "repo" | "custom", hue: number, members: string[] = []): GroupOut =>
  ({ id, name, kind, color: `0.64 0.21 ${hue}`, member_ids: members });
