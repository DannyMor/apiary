"""Keep-score: how much a session is worth keeping, 0..100, with reasons.

Rule based for now, mirroring the prototype. A YAML policy replaces the
constants in a later stage; the shape (features in, score + reasons out) stays.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

from apiary.models import Session

DAY = 86400.0
RECENCY_HORIZON_DAYS = 75.0
REVIEW_RE = re.compile(r"^review pr\b", re.I)
ONE_OFF_RE = re.compile(r"typo|quick check|explain\b", re.I)
FAILED_RE = re.compile(r"failed attempt", re.I)


@dataclass(frozen=True)
class Scored:
    score: int
    reasons: list[str]


def recency(s: Session, now: float | None = None) -> float:
    days = ((now or time.time()) - s.last_active_at) / DAY
    return max(0.0, min(1.0, 1.0 - days / RECENCY_HORIZON_DAYS))


def score_session(s: Session, now: float | None = None) -> Scored:
    now = now or time.time()
    rec = recency(s, now)
    why: list[str] = []
    sc = 18 + 42 * rec
    if s.files_edited:
        sc += min(25, s.files_edited * 3)
        why.append(f"{s.files_edited} files edited")
    sc += min(10, s.msg_count / 10)
    if s.parent_id and s.files_edited <= 1:
        sc -= 25
        why.append("fork with no divergence")
    if REVIEW_RE.search(s.title):
        sc -= 22
        why.append("code review of a PR")
    if ONE_OFF_RE.search(s.title):
        sc -= 15
        why.append("one-off question")
    if FAILED_RE.search(s.title):
        sc -= 20
        why.append("marked as failed attempt")
    if s.msg_count < 6 and not s.files_edited:
        sc -= 15
        why.append("few messages, nothing edited")
    if rec < 0.15:
        why.append(f"idle for {int((now - s.last_active_at) / DAY)} days")
    if s.status == "live":
        sc, why = 100, ["running now"]
    return Scored(score=int(max(0, min(100, round(sc)))), reasons=why)
