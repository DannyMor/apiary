import type { GroupUI, Session } from "./model";

export function fakeSession(patch: Partial<Session> & { id: string }): Session {
  return {
    title: "untitled", repo: "repo:a", swarms: [], createdAt: 0, lastActiveAt: 0, msgCount: 4, toolCalls: 1,
    filesEdited: 0, parentId: null, branch: "main", worktree: null, active: false, status: "ok", score: 50,
    reasons: [], tags: [], decision: null, hasHoney: false, ...patch,
  };
}

export function fakeGroups(): Record<string, GroupUI> {
  const mk = (id: string, name: string, kind: "repo" | "custom", h: number): GroupUI => ({ id, name, kind, color: { l: 0.64, c: 0.21, h }, memberIds: [] });
  return {
    "repo:a": mk("repo:a", "a", "repo", 22), "repo:b": mk("repo:b", "b", "repo", 152), "repo:c": mk("repo:c", "c", "repo", 262),
    "swarm:x": mk("swarm:x", "Billing", "custom", 300), "swarm:empty": mk("swarm:empty", "Empty", "custom", 330),
  };
}
