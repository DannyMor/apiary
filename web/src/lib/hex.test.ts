import { axialToWorld, ringCount, spiral } from "./hex";

test("spiral fills rings outward with distinct cells", () => {
  const cells = spiral(7);
  expect(cells[0]).toEqual({ q: 0, r: 0 });
  expect(new Set(cells.map((c) => `${c.q},${c.r}`)).size).toBe(7);
  expect(spiral(19)).toHaveLength(19);
});

test("ringCount is the number of rings needed for n cells", () => {
  expect([ringCount(1), ringCount(7), ringCount(8), ringCount(19)]).toEqual([0, 1, 2, 2]);
});

test("axialToWorld uses pointy-top hex spacing", () => {
  expect(axialToWorld(1, 0, 1).x).toBeCloseTo(Math.sqrt(3));
  expect(axialToWorld(0, 1, 1)).toEqual({ x: Math.sqrt(3) / 2, z: 1.5 });
});
