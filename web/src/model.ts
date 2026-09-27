import type { Decision, GroupOut, SessionOut } from "./api/types";
import { parseColor, type Oklch } from "./lib/color";

/** A session as the UI holds it: milliseconds, a home hive, the swarms it is in. */
export interface Session {
  id: string; title: string; repo: string; swarms: string[];
  createdAt: number; lastActiveAt: number; msgCount: number; toolCalls: number; filesEdited: number;
  parentId: string | null; branch: string | null; worktree: string | null;
  active: boolean; status: "ok" | "archived"; score: number; reasons: string[];
  tags: string[]; decision: Decision | null; hasHoney: boolean;
}
export interface GroupUI { id: string; name: string; kind: "repo" | "custom"; color: Oklch; memberIds: string[] }

export function sessionFromApi(a: SessionOut): Session {
  return {
    id: a.id, title: a.title,
    repo: a.groups.find((g) => g.startsWith("repo:")) ?? `repo:${a.repo_name}`,
    swarms: a.groups.filter((g) => g.startsWith("swarm:")),
    createdAt: a.created_at * 1000, lastActiveAt: a.last_active_at * 1000,
    msgCount: a.msg_count, toolCalls: a.tool_calls, filesEdited: a.files_edited,
    parentId: a.parent_id, branch: a.branch, worktree: a.worktree,
    active: a.status === "live", status: a.status === "archived" ? "archived" : "ok",
    score: a.score, reasons: a.reasons, tags: a.tags, decision: a.decision, hasHoney: a.has_honey,
  };
}

export function groupFromApi(g: GroupOut): GroupUI {
  return { id: g.id, name: g.name, kind: g.kind, color: parseColor(g.color), memberIds: g.member_ids };
}
