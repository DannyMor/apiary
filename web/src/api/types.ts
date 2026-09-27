// Shapes served by the daemon (src/apiary/models.py) and the websocket contract (src/apiary/watcher.py).
export type Status = "live" | "idle" | "archived" | "purged";
export type Decision = "keep" | "archive" | "summarize_archive";

/** One way to open a session outside Apiary: navigate to `url` or run `command`. */
export interface Opening { label: string; url: string | null; command: string | null }

export interface SessionOut {
  id: string; repo_path: string; repo_name: string; branch: string | null; title: string;
  created_at: number; last_active_at: number; mtime: number; size_bytes: number;
  msg_count: number; tool_calls: number; files_edited: number; parent_id: string | null;
  status: Status; transcript: string; worktree: string | null;
  score: number; reasons: string[]; tags: string[]; groups: string[]; decision: Decision | null; has_honey: boolean;
  openings: Opening[];
}
export interface GroupOut { id: string; name: string; kind: "repo" | "custom"; color: string | null; member_ids: string[] }
export interface IndexReport { scanned: number; indexed: number; unchanged: number; superseded: number; purged: number; duration_s: number; changed: string[] }
export interface ApplyReport { archived: string[]; summarized: string[]; failed: { session_id: string; error: string }[] }
export interface HoneyOut { path: string; text: string }
export type Settings = Record<string, unknown>;

export type ApiEvent =
  | { type: "session.updated"; session: SessionOut }
  | { type: "session.live"; id: string; live: boolean }
  | { type: "index.progress"; report: IndexReport }
  | { type: "group.updated"; group: GroupOut }
  | { type: "group.deleted"; id: string }
  | { type: "settings.updated"; settings: Settings };
