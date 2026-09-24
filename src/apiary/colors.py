"""Group colors as OKLCH ``"l c h"`` strings, suggested the way the prototype does it."""

from __future__ import annotations

PALETTE_HUES = (22.0, 152.0, 262.0, 322.0)  # rose, emerald, blue, violet: the first picks
AVOID_HUES = (88.0, 104.0, 120.0)  # olive/mustard band: counts as taken, never suggested
L, C = 0.64, 0.21


def format_color(hue: float) -> str:
    return f"{L:.2f} {C:.2f} {hue:g}"


def hue_of(color: str) -> float:
    return float(color.split()[2])


def suggest(existing: list[str], n: int) -> list[str]:
    """``n`` colors, each in the middle of the largest hue gap left by ``existing`` and the avoided band."""
    if not existing:
        return [format_color(h) for h in PALETTE_HUES[:n]]
    hues = [hue_of(c) for c in existing] + list(AVOID_HUES)
    out: list[str] = []
    while len(out) < n:
        hues.sort()
        best, at = -1.0, 0
        for i, a in enumerate(hues):
            b = hues[i + 1] if i + 1 < len(hues) else hues[0] + 360
            if b - a > best:
                best, at = b - a, i
        mid = (hues[at] + best / 2) % 360
        out.append(format_color(mid))
        hues.append(mid)
    return out
