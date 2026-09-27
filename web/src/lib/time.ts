export const DAY = 86_400_000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function ageText(ms: number, now: number): string {
  const d = (now - ms) / DAY;
  if (d < 1 / 24) return "minutes ago";
  if (d < 1) return Math.round(d * 24) + "h ago";
  if (d < 30) return Math.round(d) + "d ago";
  return Math.round(d / 7) + "w ago";
}
export const DATE_BUCKETS = ["Today", "Yesterday", "Past week", "Past two weeks", "Past month", "Past two months", "Older"];
export function dateBucket(ms: number, now: number): number {
  const d = (now - ms) / DAY;
  return d < 1 ? 0 : d < 2 ? 1 : d < 7 ? 2 : d < 14 ? 3 : d < 30 ? 4 : d < 60 ? 5 : 6;
}
/** 1 when touched now, 0 after 75 idle days; the same curve as scoring.py. */
export const recencyOf = (lastActiveAt: number, now: number) => clamp(1 - (now - lastActiveAt) / DAY / 75, 0, 1);
