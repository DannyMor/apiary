import { autoTagsOf, buildSections, emptyFilter, filterActive, matchesFilter } from "./sections";
import type { Filter } from "./sections";
import { fakeGroups, fakeSession } from "../test-fakes";

const now = 1_800_000_000_000;
const groups = fakeGroups();
const sessions = [
  fakeSession({ id: "a1", repo: "repo:a", title: "Refactor auth", score: 80, lastActiveAt: now - 3_600_000, filesEdited: 2 }),
  fakeSession({ id: "a2", repo: "repo:a", title: "Review PR 9", score: 20, lastActiveAt: now - 40 * 86_400_000, parentId: "a1" }),
  fakeSession({ id: "b1", repo: "repo:b", title: "Docs", score: 50, lastActiveAt: now - 5 * 86_400_000, swarms: ["swarm:x"], tags: ["needs-review"] }),
];

test("matchesFilter by text, hive, score, recency and labels", () => {
  const f = (patch: Partial<Filter>): Filter => ({ ...emptyFilter(), ...patch });
  expect(filterActive(emptyFilter())).toBe(false);
  expect(matchesFilter(sessions[0], f({ q: "AUTH" }), groups, now)).toBe(true);
  expect(matchesFilter(sessions[0], f({ q: "docs" }), groups, now)).toBe(false);
  expect(matchesFilter(sessions[2], f({ groups: new Set(["swarm:x"]) }), groups, now)).toBe(true);
  expect(matchesFilter(sessions[1], f({ scoreMin: 30 }), groups, now)).toBe(false);
  expect(matchesFilter(sessions[1], f({ within: 7 }), groups, now)).toBe(false);
  expect(matchesFilter(sessions[1], f({ kinds: new Set(["fork"]) }), groups, now)).toBe(true);
  expect(matchesFilter(sessions[2], f({ kinds: new Set(["needs-review"]) }), groups, now)).toBe(true);
  expect(autoTagsOf(sessions[0])).toEqual(["edits"]);
});

test("buildSections by hive lists swarm members under the swarm and ghosts them at home", () => {
  const secs = buildSections(sessions, groups, ["repo:a", "repo:b", "swarm:x", "swarm:empty"], "group", "lastActive", now);
  const byId = Object.fromEntries(secs.map((s) => [s.key, s]));
  expect(byId["repo:a"].rows.map((s) => s.id)).toEqual(["a1", "a2"]);
  expect(byId["repo:b"].rows).toEqual([]);
  expect(byId["repo:b"].ghosts.map((s) => s.id)).toEqual(["b1"]);
  expect(byId["swarm:x"].rows.map((s) => s.id)).toEqual(["b1"]);
  expect(byId["swarm:empty"].rows).toEqual([]);
});

test("buildSections by date and by score use the natural order", () => {
  const dates = buildSections(sessions, groups, ["repo:a", "repo:b"], "date", "score", now);
  expect(dates.map((s) => s.title)).toEqual(["Today", "Past week", "Past two months"]);
  const scores = buildSections(sessions, groups, ["repo:a", "repo:b"], "score", "name", now);
  expect(scores.map((s) => s.title)).toEqual(["80–89", "50–59", "20–29"]);
  expect(buildSections(sessions, groups, [], "none", "name", now)[0].rows.map((s) => s.id)).toEqual(["b1", "a1", "a2"]);
});
