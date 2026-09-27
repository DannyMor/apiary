import { computeLayout, heightFor } from "./layout";
import { fakeGroups, fakeSession } from "../test-fakes";

const now = 1_800_000_000_000;

test("computeLayout places cells in their display group, ghosts loans at home, hides empty hives", () => {
  const groups = fakeGroups();
  const sessions = [
    fakeSession({ id: "a1", repo: "repo:a", lastActiveAt: now }),
    fakeSession({ id: "b1", repo: "repo:b", swarms: ["swarm:x"], lastActiveAt: now }),
    fakeSession({ id: "c1", repo: "repo:c", status: "archived", lastActiveAt: now }),
  ];
  const lay = computeLayout(sessions, groups, ["repo:a", "repo:b", "repo:c", "swarm:x"], "recency", now);
  expect([...lay.centers.keys()]).toEqual(["repo:a", "repo:b", "swarm:x"]);
  expect(lay.displayGroup.get("b1")).toBe("swarm:x");
  expect(lay.ghostPos.has("b1")).toBe(true);
  expect(lay.pos.has("c1")).toBe(false);
  const bPos = lay.pos.get("b1")!, xCenter = lay.centers.get("swarm:x")!;
  expect(Math.hypot(bPos.x - xCenter.x, bPos.z - xCenter.z)).toBeLessThan(2);
  expect(lay.count.get("repo:b")).toBe(0);
  expect(lay.radius.get("repo:a")).toBeGreaterThan(0);
});

test("heightFor follows recency or score by lens", () => {
  const fresh = fakeSession({ id: "f", lastActiveAt: now, score: 10 });
  const old = fakeSession({ id: "o", lastActiveAt: now - 70 * 86_400_000, score: 90 });
  expect(heightFor(fresh, "recency", now)).toBeGreaterThan(heightFor(old, "recency", now));
  expect(heightFor(fresh, "score", now)).toBeLessThan(heightFor(old, "score", now));
  expect(heightFor({ ...old, active: true }, "recency", now)).toBeCloseTo(6.55);
});
