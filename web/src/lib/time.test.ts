import { DAY, ageText, dateBucket, recencyOf } from "./time";

test("ageText, dateBucket and recencyOf read from a fixed now", () => {
  const now = 1_800_000_000_000;
  expect(ageText(now - DAY * 3, now)).toBe("3d ago");
  expect(ageText(now - DAY * 21, now)).toBe("21d ago");
  expect(ageText(now - DAY * 35, now)).toBe("5w ago");
  expect(ageText(now - 5 * 3_600_000, now)).toBe("5h ago");
  expect(dateBucket(now - DAY * 0.5, now)).toBe(0);
  expect(dateBucket(now - DAY * 10, now)).toBe(3);
  expect(recencyOf(now, now)).toBe(1);
  expect(recencyOf(now - 75 * DAY, now)).toBe(0);
  expect(recencyOf(now - 37.5 * DAY, now)).toBeCloseTo(0.5);
});
