import { structureKey, type SceneInput } from "./engine";
import { computeLayout } from "../lib/layout";
import { fakeGroups, fakeSession } from "../test-fakes";

const now = 1_800_000_000_000;

function input(sessions: ReturnType<typeof fakeSession>[], at = now): SceneInput {
  const groups = fakeGroups();
  const groupOrder = ["repo:a", "repo:b"];
  const layout = computeLayout(sessions, groups, groupOrder, "recency", at);
  return { sessions, groups, groupOrder, layout, lens: "recency", now: at, shown: new Set(sessions.map((s) => s.id)), filtering: false };
}

test("a session that only got newer or busier keeps the same scene structure", () => {
  const before = input([fakeSession({ id: "a1", repo: "repo:a", lastActiveAt: now - 5_000 }), fakeSession({ id: "a2", repo: "repo:a", lastActiveAt: now - 90_000 })]);
  const after = input([fakeSession({ id: "a1", repo: "repo:a", lastActiveAt: now, msgCount: 40 }), fakeSession({ id: "a2", repo: "repo:a", lastActiveAt: now - 90_000 })], now + 1_000);
  expect(structureKey(after)).toBe(structureKey(before));
});

test("a session appearing or starting to run changes the scene structure", () => {
  const base = [fakeSession({ id: "a1", repo: "repo:a", lastActiveAt: now })];
  const key = structureKey(input(base));
  expect(structureKey(input([...base, fakeSession({ id: "a2", repo: "repo:a", lastActiveAt: now })]))).not.toBe(key);
  expect(structureKey(input([{ ...base[0], active: true }]))).not.toBe(key);
});
