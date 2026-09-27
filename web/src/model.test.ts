import { groupFromApi, sessionFromApi } from "./model";
import type { SessionOut } from "./api/types";

const api: SessionOut = {
  id: "s1", repo_path: "/u/src/a", repo_name: "a", branch: "main", title: "Refactor auth",
  created_at: 1_700_000_000, last_active_at: 1_700_001_000, mtime: 1_700_001_000, size_bytes: 10,
  msg_count: 8, tool_calls: 3, files_edited: 2, parent_id: null, status: "live", transcript: "/x.jsonl",
  worktree: "wt-1", score: 87, reasons: ["2 files edited"], tags: ["billing"], groups: ["repo:a", "swarm:ab12"],
  decision: null, has_honey: false,
};

test("sessionFromApi maps seconds to ms, status to active, groups to hive and swarms", () => {
  const s = sessionFromApi(api);
  expect(s.lastActiveAt).toBe(1_700_001_000_000);
  expect(s.repo).toBe("repo:a");
  expect(s.swarms).toEqual(["swarm:ab12"]);
  expect(s.active).toBe(true);
  expect(s.status).toBe("ok");
  expect(sessionFromApi({ ...api, status: "archived" }).status).toBe("archived");
  expect(sessionFromApi({ ...api, groups: [] }).repo).toBe("repo:a");
});

test("groupFromApi parses the color string", () => {
  const g = groupFromApi({ id: "repo:a", name: "a", kind: "repo", color: "0.64 0.21 22", member_ids: ["s1"] });
  expect(g.color).toEqual({ l: 0.64, c: 0.21, h: 22 });
  expect(groupFromApi({ id: "repo:b", name: "b", kind: "repo", color: null, member_ids: [] }).color.h).toBe(22);
});
