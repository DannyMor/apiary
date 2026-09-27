import { useApiary } from "../hooks";
import { useSections } from "../derived";
import type { Session } from "../model";
import { cssOf, shadeOf } from "../lib/color";
import type { Section } from "../lib/sections";
import { ageText, recencyOf } from "../lib/time";
import { Icon } from "./icons";

export function SessionsList() {
  const sections = useSections();
  const groupBy = useApiary((s) => s.groupBy);
  const collapsed = useApiary((s) => s.collapsed);
  const groups = useApiary((s) => s.groups);
  const sessions = useApiary((s) => s.sessions);
  const archived = Object.values(sessions).filter((s) => s.status === "archived");
  return (
    <>
      {sections.map((sec) => (
        <div key={sec.id} data-testid={`section-${sec.id}`}>
          {sec.id !== "all" && (groupBy === "group" ? <GroupHead sec={sec} /> : <SectionHead sec={sec} />)}
          {(sec.id === "all" || !collapsed[sec.id]) && (
            <>
              {sec.rows.map((s) => <Row key={s.id} s={s} ghost={false} sec={sec} />)}
              {sec.ghosts.map((s) => <Row key={`g-${s.id}`} s={s} ghost sec={sec} />)}
              {!sec.rows.length && !sec.ghosts.length && <div className="empty">{sec.id === "all" ? "No sessions." : groups[sec.key]?.kind === "custom" ? "Empty swarm. Select cells and add them here." : "Every cell is on loan."}</div>}
            </>
          )}
        </div>
      ))}
      {archived.length > 0 && <ArchiveSection archived={archived} />}
    </>
  );
}

function useSectionSelection(sec: Section) {
  const selected = useApiary((s) => s.selected);
  const select = useApiary((s) => s.select);
  const rows = sec.rows.concat(sec.ghosts);
  const n = rows.filter((r) => selected.has(r.id)).length;
  const state = !rows.length || !n ? "none" : n === rows.length ? "all" : "some";
  const toggleAll = () => { const all = state === "all"; for (const r of rows) if (all ? selected.has(r.id) : !selected.has(r.id)) select(r.id, true); };
  return { state, toggleAll };
}
function SecSel({ sec }: { sec: Section }) {
  const { state, toggleAll } = useSectionSelection(sec);
  return (
    <button className={`secsel ${state}`} title={state === "all" ? "Deselect this section" : "Select everything in this section"} onClick={toggleAll}>
      {state === "all" ? <Icon.checkAll /> : state === "some" ? <Icon.checkSome /> : <Icon.checkNone />}
    </button>
  );
}
function SectionHead({ sec }: { sec: Section }) {
  const collapsed = useApiary((s) => s.collapsed);
  const toggleCollapsed = useApiary((s) => s.toggleCollapsed);
  return (
    <div className={`ghead ${collapsed[sec.id] ? "closed" : ""}`}>
      <button className="caret" aria-label="collapse" onClick={() => toggleCollapsed(sec.id)}>▾</button>
      <span className="gname">{sec.title}</span><span className="count">{sec.rows.length}</span>
      <SecSel sec={sec} />
    </div>
  );
}
function GroupHead({ sec }: { sec: Section }) {
  const g = useApiary((s) => s.groups[sec.key]);
  const collapsed = useApiary((s) => s.collapsed);
  const toggleCollapsed = useApiary((s) => s.toggleCollapsed);
  const openDialog = useApiary((s) => s.openDialog);
  const requestCamera = useApiary((s) => s.requestCamera);
  if (!g) return null;
  const count = sec.rows.length + (sec.ghosts.length ? ` +${sec.ghosts.length}` : "");
  return (
    <div className={`ghead ${collapsed[sec.id] ? "closed" : ""}`} style={{ "--gc": cssOf(g.color) } as React.CSSProperties}>
      <button className="caret" aria-label="collapse" onClick={() => toggleCollapsed(sec.id)}>▾</button>
      <button className="swatch" style={{ background: cssOf(g.color) }} title="Change color" onClick={() => openDialog({ kind: "color", gid: g.id })} />
      <button className="gname" title="Focus in world" onClick={() => requestCamera({ kind: "group", gid: g.id })}>{g.name}</button>
      {g.kind === "custom" && <span className="kind">swarm</span>}
      <span className="count">{count}</span>
      <SecSel sec={sec} />
      {g.kind === "custom" && <button className="edit" title="Edit group" onClick={() => openDialog({ kind: "swarm", gid: g.id })}><Icon.edit /></button>}
    </div>
  );
}

export function Row({ s, ghost, sec }: { s: Session; ghost: boolean; sec?: Section }) {
  const g = useApiary((st) => st.groups[s.repo]);
  const display = useApiary((st) => (sec && ghost ? st.groups[sec.key === s.repo ? (s.swarms.find((x) => st.groups[x]) ?? s.repo) : sec.key] : undefined));
  const now = useApiary((st) => st.now);
  const isSel = useApiary((st) => st.selected.has(s.id));
  const select = useApiary((st) => st.select);
  const setHover = useApiary((st) => st.setHover);
  const requestCamera = useApiary((st) => st.requestCamera);
  if (!g) return null;
  const rec = recencyOf(s.lastActiveAt, now), css = cssOf(shadeOf(g.color, rec, s.active));
  const bits = [g.name, ageText(s.lastActiveAt, now), `${s.msgCount} msgs`];
  if (s.worktree) bits.push(s.worktree);
  if (s.parentId) bits.push("fork");
  if (ghost && display && display.id !== s.repo) bits.push(`in ${display.name}`);
  return (
    <div className={`row ${isSel ? "sel" : ""} ${ghost ? "ghost" : ""}`} style={{ "--rowc": cssOf(g.color) } as React.CSSProperties}
      onClick={(e) => { select(s.id, e.shiftKey); if (!e.shiftKey) requestCamera({ kind: "session", id: s.id }); }}
      onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
      <span className="bar" style={{ background: css }} />
      <span className="body" style={{ opacity: (0.5 + 0.5 * (s.active ? 1 : rec)).toFixed(2) }}>
        <span className="title">{s.title}</span><span className="meta">{bits.join(", ")}</span>
        {s.tags.length > 0 && <span className="tags">{s.tags.map((t) => <span key={t}>{t}</span>)}</span>}
      </span>
      <span className="right">
        {s.active && <span className="pulse" style={{ "--pc": css } as React.CSSProperties} />}
        <span className={`score ${s.score >= 70 ? "hi" : s.score < 40 ? "lo" : ""}`} title="keep score">{s.score}</span>
      </span>
    </div>
  );
}

function ArchiveSection({ archived }: { archived: Session[] }) {
  const collapsed = useApiary((s) => s.collapsed);
  const toggleCollapsed = useApiary((s) => s.toggleCollapsed);
  const groups = useApiary((s) => s.groups);
  const openDialog = useApiary((s) => s.openDialog);
  const restore = useApiary((s) => s.restore);
  const showToast = useApiary((s) => s.showToast);
  const btn = { padding: "2px 6px", fontSize: 12 } as const;
  return (
    <div data-testid="section-archive">
      <div className={`ghead ${collapsed.archive ? "closed" : ""}`}>
        <button className="caret" aria-label="collapse" onClick={() => toggleCollapsed("archive")}>▾</button>
        <span className="swatch" style={{ background: "var(--border)" }} /><span className="gname">Archive</span><span className="count">{archived.length}</span>
      </div>
      {!collapsed.archive && archived.map((s) => (
        <div key={s.id} className="row ghost" data-archived="1">
          <span className="bar" style={{ background: "var(--border)" }} />
          <span className="body"><span className="title">{s.title}</span><span className="meta">{groups[s.repo]?.name ?? s.repo}, {s.hasHoney ? "honey saved, " : ""}transcript archived</span></span>
          <span className="right">
            {s.hasHoney && <button className="btn quiet" style={btn} onClick={() => openDialog({ kind: "honey", id: s.id })}>Honey</button>}
            <button className="btn quiet" style={btn} onClick={() => restore(s.id).then(() => showToast(`Restored to ${groups[s.repo]?.name ?? "its hive"}`)).catch(() => undefined)}>Restore</button>
            <button className="btn quiet" style={btn} title="Delete the archived transcript for good" onClick={() => openDialog({ kind: "purge", id: s.id })}>Purge</button>
          </span>
        </div>
      ))}
    </div>
  );
}
