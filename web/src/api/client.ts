import type { ApiEvent, ApplyReport, Decision, GroupOut, SessionOut, Settings } from "./types";

export type EventHandler = (ev: ApiEvent) => void;
export type StatusHandler = (status: "live" | "offline") => void;

/** Everything the UI asks the daemon for. FakeApi implements it in memory for tests. */
export interface ApiClient {
  sessions(): Promise<SessionOut[]>;
  session(id: string): Promise<SessionOut>;
  groups(): Promise<GroupOut[]>;
  settings(): Promise<Settings>;
  putSettings(patch: Settings): Promise<Settings>;
  createGroup(body: { name: string; color?: string | null; member_ids: string[] }): Promise<GroupOut>;
  patchGroup(id: string, body: { name?: string | null; color?: string | null }): Promise<GroupOut>;
  deleteGroup(id: string): Promise<void>;
  addMembers(id: string, ids: string[]): Promise<GroupOut>;
  removeMember(id: string, sid: string): Promise<GroupOut>;
  addTag(id: string, tag: string): Promise<SessionOut>;
  removeTag(id: string, tag: string): Promise<SessionOut>;
  decide(id: string, decision: Decision): Promise<SessionOut>;
  undecide(id: string): Promise<SessionOut>;
  apply(): Promise<ApplyReport>;
  restore(id: string): Promise<SessionOut>;
  purge(ids: string[]): Promise<{ purged: string[] }>;
  honey(id: string): Promise<string>;
  suggestColors(n: number, exclude?: string[]): Promise<string[]>;
  /** Subscribe to the websocket; the returned function disconnects. Reconnects on its own. */
  events(onEvent: EventHandler, onStatus: StatusHandler): () => void;
}

const enc = encodeURIComponent;

export class HttpApi implements ApiClient {
  constructor(private base = "") {}

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(this.base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      let detail = String(r.status);
      try { detail = (await r.json()).detail || detail; } catch { /* not json */ }
      throw new Error(`${method} ${path}: ${detail}`);
    }
    return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
  }

  sessions() { return this.json<SessionOut[]>("GET", "/api/sessions?limit=5000"); }
  session(id: string) { return this.json<SessionOut>("GET", `/api/sessions/${enc(id)}`); }
  groups() { return this.json<GroupOut[]>("GET", "/api/groups"); }
  settings() { return this.json<Settings>("GET", "/api/settings"); }
  putSettings(patch: Settings) { return this.json<Settings>("PUT", "/api/settings", patch); }
  createGroup(body: { name: string; color?: string | null; member_ids: string[] }) { return this.json<GroupOut>("POST", "/api/groups", body); }
  patchGroup(id: string, body: { name?: string | null; color?: string | null }) { return this.json<GroupOut>("PATCH", `/api/groups/${enc(id)}`, body); }
  deleteGroup(id: string) { return this.json<void>("DELETE", `/api/groups/${enc(id)}`); }
  addMembers(id: string, ids: string[]) { return this.json<GroupOut>("POST", `/api/groups/${enc(id)}/members`, { session_ids: ids }); }
  removeMember(id: string, sid: string) { return this.json<GroupOut>("DELETE", `/api/groups/${enc(id)}/members/${enc(sid)}`); }
  addTag(id: string, tag: string) { return this.json<SessionOut>("POST", `/api/sessions/${enc(id)}/tags`, { tag }); }
  removeTag(id: string, tag: string) { return this.json<SessionOut>("DELETE", `/api/sessions/${enc(id)}/tags/${enc(tag)}`); }
  decide(id: string, decision: Decision) { return this.json<SessionOut>("POST", "/api/gc/decisions", { session_id: id, decision }); }
  undecide(id: string) { return this.json<SessionOut>("DELETE", `/api/gc/decisions/${enc(id)}`); }
  apply() { return this.json<ApplyReport>("POST", "/api/gc/apply"); }
  restore(id: string) { return this.json<SessionOut>("POST", `/api/sessions/${enc(id)}/restore`); }
  purge(ids: string[]) { return this.json<{ purged: string[] }>("POST", "/api/gc/purge", { session_ids: ids }); }
  async honey(id: string) {
    const r = await fetch(`${this.base}/api/sessions/${enc(id)}/honey`);
    if (!r.ok) throw new Error(`no honey (${r.status})`);
    return r.text();
  }
  suggestColors(n: number, exclude: string[] = []) {
    const q = new URLSearchParams([["n", String(n)], ...exclude.map((c) => ["exclude", c] as [string, string])]);
    return this.json<string[]>("GET", `/api/colors/suggest?${q}`);
  }

  events(onEvent: EventHandler, onStatus: StatusHandler) {
    let ws: WebSocket | null = null, stopped = false, timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}${this.base}/api/events`);
      ws.onopen = () => onStatus("live");
      ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      ws.onclose = () => { onStatus("offline"); if (!stopped) timer = setTimeout(connect, 2000 + Math.random() * 1000); };
    };
    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); ws?.close(); };
  }
}
