import { useApiary } from "../hooks";
import { cssOf, shadeOf } from "../lib/color";
import { ageText, recencyOf } from "../lib/time";

const DECIDED: Record<string, string> = { archive: "marked: archive", summarize_archive: "marked: summarize and archive" };

export function Keeper() {
  const sessions = useApiary((s) => s.sessions);
  const groups = useApiary((s) => s.groups);
  const threshold = useApiary((s) => s.threshold);
  const setThreshold = useApiary((s) => s.setThreshold);
  const now = useApiary((s) => s.now);
  const decide = useApiary((s) => s.decide);
  const applyMarks = useApiary((s) => s.applyMarks);
  const keeperBusy = useApiary((s) => s.keeperBusy);
  const showToast = useApiary((s) => s.showToast);
  const openDialog = useApiary((s) => s.openDialog);
  const live = Object.values(sessions).filter((s) => s.status !== "archived");
  const cands = live.filter((s) => s.score < threshold && s.decision !== "keep" && !s.active).sort((a, b) => a.score - b.score);
  const kept = live.filter((s) => s.decision === "keep").length;
  const pending = live.filter((s) => s.decision === "archive" || s.decision === "summarize_archive").length;
  const apply = async () => {
    try {
      const r = await applyMarks();
      showToast(`Archived ${r.archived.length}, summarized ${r.summarized.length}` + (r.failed.length ? `, failed ${r.failed.length}: ${r.failed[0].error}` : ""));
    } catch { /* toasted by the store */ }
  };
  return (
    <>
      <div className="gc-head">
        The keeper suggests culling cells scoring below <b>{threshold}</b>. Height in the world now shows the score, so candidates are the low ones. Mark cells, then apply: archiving moves the transcript out of Claude's session list into Apiary's archive; honey is the summary kept next to it.
        <input type="range" min="5" max="80" step="1" value={threshold} onChange={(e) => setThreshold(+e.target.value, false)} onPointerUp={() => setThreshold(threshold, true)} onKeyUp={() => setThreshold(threshold, true)} />
        <div>
          {cands.length} candidate{cands.length === 1 ? "" : "s"}{kept ? `, ${kept} excluded by you` : ""}
          {pending > 0 && <button className="btn primary" style={{ marginLeft: 8 }} disabled={keeperBusy} onClick={() => void apply()}>{keeperBusy ? "The keeper is working…" : `Apply ${pending} mark${pending === 1 ? "" : "s"}`}</button>}
        </div>
      </div>
      {!cands.length && <div className="empty">Nothing to collect at this threshold.</div>}
      {cands.map((s) => {
        const g = groups[s.repo], d = s.decision;
        return (
          <div className="gcard" key={s.id}>
            <div className="top"><span className="bar" style={{ background: g ? cssOf(shadeOf(g.color, recencyOf(s.lastActiveAt, now), false)) : undefined }} /><span className="title" title={s.title}>{s.title}</span><span className="sc">{s.score}</span></div>
            <div className="why">
              {s.reasons.length ? s.reasons.map((r) => <span key={r}>{r}</span>) : <span>low score</span>}
              <span>{g?.name ?? s.repo}</span><span>{ageText(s.lastActiveAt, now)}</span>
              {d && <span><b>{DECIDED[d] ?? d}</b></span>}
            </div>
            <div className="acts">
              {d ? <button className="btn" onClick={() => decide(s.id, null).then(() => showToast("Mark removed")).catch(() => undefined)}>Undo</button> : (
                <>
                  <button className="btn" onClick={() => decide(s.id, "keep").then(() => showToast("Kept, will not be suggested again")).catch(() => undefined)}>Keep</button>
                  <button className="btn" onClick={() => decide(s.id, "archive").then(() => showToast("Marked for the keeper: archive")).catch(() => undefined)}>Archive</button>
                  <button className="btn primary" onClick={() => openDialog({ kind: "summarize", id: s.id })}>Summarize and archive</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
