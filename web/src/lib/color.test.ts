import { cssOf, deltaE, fmtColor, gamutMap, parseColor, shadeOf, suggestColors } from "./color";

test("cssOf renders an sRGB triple and gamutMap stays in range", () => {
  expect(cssOf({ l: 0.64, c: 0.21, h: 22 })).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  for (const v of gamutMap({ l: 0.64, c: 0.9, h: 120 })) expect(v).toBeGreaterThanOrEqual(0);
  for (const v of gamutMap({ l: 0.64, c: 0.9, h: 120 })) expect(v).toBeLessThanOrEqual(1);
});

test("shadeOf greys out and sinks with age, lifts when running", () => {
  const base = { l: 0.64, c: 0.21, h: 22 };
  const fresh = shadeOf(base, 1, false), old = shadeOf(base, 0.1, false), live = shadeOf(base, 0.1, true);
  expect(old.c).toBeLessThan(fresh.c);
  expect(old.l).toBeLessThan(fresh.l);
  expect(live.l).toBeGreaterThan(fresh.l);
  expect(fresh.h).toBe(22);
});

test("suggestColors mirrors the daemon: palette first, then the largest hue gap, olive band avoided", () => {
  expect(suggestColors([], 2).map((c) => c.h)).toEqual([22, 152]);
  expect(suggestColors([{ l: 0.64, c: 0.21, h: 22 }], 1)[0].h).toBe(251);
  const hues = suggestColors([{ l: 0.64, c: 0.21, h: 22 }], 10).map((c) => c.h);
  expect(hues.every((h) => h < 85 || h > 125)).toBe(true);
});

test("parseColor and fmtColor round-trip the daemon's 'l c h' strings", () => {
  expect(parseColor("0.64 0.21 185.5")).toEqual({ l: 0.64, c: 0.21, h: 185.5 });
  expect(fmtColor({ l: 0.64, c: 0.21, h: 185.5 })).toBe("0.64 0.21 185.5");
  expect(parseColor(null).h).toBe(22);
  expect(deltaE({ l: 0.64, c: 0.21, h: 22 }, { l: 0.64, c: 0.21, h: 22 })).toBe(0);
});
