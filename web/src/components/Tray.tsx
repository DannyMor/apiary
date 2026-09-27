import { useEffect, useRef, type CSSProperties } from "react";
import { useApiary } from "../hooks";
import { useCustomTags, useSelectedSessions, useShown } from "../derived";
import { cssOf } from "../lib/color";
import { AUTO_NAMES, AUTO_TAGS } from "../lib/sections";
import { Icon } from "./icons";
import { Keeper } from "./Keeper";
import { SessionsList } from "./SessionsList";

export function Tray() {
  const tab = useApiary((s) => s.tab);
  const setTab = useApiary((s) => s.setTab);
  const groupOrder = useApiary((s) => s.groupOrder);
  const groups = useApiary((s) => s.groups);
  const hiveColors = groupOrder.filter((g) => groups[g].kind === "repo").map((g) => cssOf(groups[g].color));
  const brandVars = Object.fromEntries(["--c0", "--c1", "--c2"].map((v, i) => [v, hiveColors[Math.round((i * (hiveColors.length - 1)) / 2)] ?? ""]));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [tab]);
  return (
    <aside id="tray" style={brandVars as CSSProperties}>
      <div className="tray-head">
        <div className="brand">
          <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
            <path className="m1" d="M11 3l6 3.5v7L11 17l-6-3.5v-7z" /><path className="m2" d="M23 10l6 3.5v7L23 24l-6-3.5v-7z" /><path className="m3" d="M11 17l6 3.5v7L11 31l-6-3.5v-7z" />
          </svg>
          <h1>Apiary</h1><span>live</span>
        </div>
        <div className="modes" role="tablist" aria-label="View mode">
          <button role="tab" className={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}><Icon.sessions />Sessions</button>
          <button role="tab" className={tab === "gc" ? "on" : ""} onClick={() => setTab("gc")} title="The keeper: what to cull"><Icon.keeper />Keeper</button>
        </div>
        {tab === "sessions" && <SessionControls />}
      </div>
      <div className="tray-body" id="list" ref={listRef}>{tab === "gc" ? <Keeper /> : <SessionsList />}</div>
      <SelectionBar />
    </aside>
  );
}

function SessionControls() {
  const lens = useApiary((s) => s.lens);
  const setLens = useApiary((s) => s.setLens);
  const filter = useApiary((s) => s.filter);
  const setFilter = useApiary((s) => s.setFilter);
  const filterOpen = useApiary((s) => s.filterOpen);
  const setFilterOpen = useApiary((s) => s.setFilterOpen);
  const groupBy = useApiary((s) => s.groupBy);
  const setGroupBy = useApiary((s) => s.setGroupBy);
  const sort = useApiary((s) => s.sort);
  const setSort = useApiary((s) => s.setSort);
  const openDialog = useApiary((s) => s.openDialog);
  const n = (filter.groups.size ? 1 : 0) + (filter.scoreMin > 0 || filter.scoreMax < 100 ? 1 : 0) + (filter.within ? 1 : 0) + (filter.kinds.size ? 1 : 0);
  return (
    <div id="ctl-sessions">
      <div className="seg lens" role="group" aria-label="Column height shows">
        <button className={lens === "recency" ? "on" : ""} onClick={() => setLens("recency")}><Icon.recency />Recency</button>
        <button className={lens === "score" ? "on" : ""} onClick={() => setLens("score")}><Icon.score />Score</button>
      </div>
      <div className="toolbar">
        <label className="search"><Icon.search /><input type="search" placeholder="Search sessions" aria-label="Search sessions" value={filter.q} onChange={(e) => setFilter({ q: e.target.value.trim() })} /></label>
        <button className={`tool ${filterOpen ? "on" : ""}`} title="Filters" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><Icon.filter /><span className={`badge ${n ? "on" : ""}`}>{n || ""}</span></button>
        <button className="tool" title="New swarm" onClick={() => openDialog({ kind: "swarm", gid: null })}><Icon.swarm /></button>
      </div>
      <div className="toolbar">
        <label className="pill" title="Group by"><Icon.groupby />
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="group">Hive / swarm</option><option value="date">Date</option><option value="score">Score range</option><option value="none">No grouping</option>
          </select>
        </label>
        <label className="pill" title="Order by"><Icon.sort />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="lastActive">Last active</option><option value="created">Created</option><option value="score">Score</option><option value="name">Name</option>
          </select>
        </label>
      </div>
      {filterOpen && <FilterPanel />}
    </div>
  );
}

function FilterPanel() {
  const filter = useApiary((s) => s.filter);
  const setFilter = useApiary((s) => s.setFilter);
  const resetFilter = useApiary((s) => s.resetFilter);
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  const selected = useApiary((s) => s.selected);
  const select = useApiary((s) => s.select);
  const showToast = useApiary((s) => s.showToast);
  const shown = useShown();
  const tags = useCustomTags();
  const toggle = (set: Set<string>, v: string) => { const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); return next; };
  const selectShown = () => { for (const s of shown) if (!selected.has(s.id)) select(s.id, true); showToast(`${new Set([...selected, ...shown.map((s) => s.id)]).size} selected`); };
  return (
    <div className="fpanel on">
      <div className="fsec"><span>Hives and swarms</span>
        <div className="chips">{groupOrder.map((gid) => <button key={gid} className={filter.groups.has(gid) ? "on" : ""} onClick={() => setFilter({ groups: toggle(filter.groups, gid) })}><span className="dot" style={{ background: cssOf(groups[gid].color) }} />{groups[gid].name}</button>)}</div>
      </div>
      <div className="fsec"><span>Score <b>{filter.scoreMin} to {filter.scoreMax}</b></span>
        <div className="dual">
          <input type="range" min="0" max="100" value={filter.scoreMin} aria-label="Minimum score" onChange={(e) => setFilter({ scoreMin: Math.min(+e.target.value, filter.scoreMax) })} />
          <input type="range" min="0" max="100" value={filter.scoreMax} aria-label="Maximum score" onChange={(e) => setFilter({ scoreMax: Math.max(+e.target.value, filter.scoreMin) })} />
        </div>
      </div>
      <div className="fsec"><span>Active within</span>
        <select value={filter.within} onChange={(e) => setFilter({ within: +e.target.value })}>
          <option value="0">Any time</option><option value="1">Today</option><option value="7">Past week</option><option value="14">Past two weeks</option><option value="30">Past month</option><option value="60">Past two months</option>
        </select>
      </div>
      <div className="fsec"><span>Labels</span>
        <div className="chips">
          {Object.keys(AUTO_TAGS).map((k) => <button key={k} className={`auto ${filter.kinds.has(k) ? "on" : ""}`} title="Derived label" onClick={() => setFilter({ kinds: toggle(filter.kinds, k) })}>{AUTO_NAMES[k]}</button>)}
          {tags.map((t) => <button key={t} className={filter.kinds.has(t) ? "on" : ""} onClick={() => setFilter({ kinds: toggle(filter.kinds, t) })}>{t}</button>)}
        </div>
      </div>
      <div className="frow">
        <button className="btn" onClick={selectShown}>Select all shown</button>
        <button className="btn quiet" onClick={resetFilter}>Clear filters</button>
      </div>
    </div>
  );
}

function SelectionBar() {
  const selected = useSelectedSessions();
  const clearSelection = useApiary((s) => s.clearSelection);
  const openDialog = useApiary((s) => s.openDialog);
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  const addMembers = useApiary((s) => s.addMembers);
  const returnHome = useApiary((s) => s.returnHome);
  const showToast = useApiary((s) => s.showToast);
  const requestCamera = useApiary((s) => s.requestCamera);
  const swarms = groupOrder.filter((g) => groups[g].kind === "custom");
  const n = selected.length;
  const addTo = async (v: string) => {
    if (!v) return;
    const ids = selected.map((s) => s.id);
    try {
      if (v === "__home") { await returnHome(ids); showToast(`${ids.length} returned home`); }
      else { await addMembers(v, ids); showToast(`${ids.length} added to ${groups[v].name}`); requestCamera({ kind: "group", gid: v }); }
      clearSelection();
    } catch { /* toasted by the store */ }
  };
  return (
    <div className={`selbar ${n ? "on" : ""}`}>
      <div className="top"><div className="n">{n} selected</div><button className="btn quiet" title="Clear selection" onClick={clearSelection}>×</button></div>
      <div className="acts">
        <button className="btn primary" title="New swarm from selection" onClick={() => openDialog({ kind: "swarm", gid: null })}>New swarm</button>
        <select className="btn" title="Add to an existing group" value="" onChange={(e) => void addTo(e.target.value)}>
          <option value="">Add to group…</option>
          {swarms.map((g) => <option key={g} value={g}>{groups[g].name}</option>)}
          <option value="__home">Return to home hive</option>
        </select>
        <button className="btn" onClick={() => openDialog({ kind: "labels" })}>Labels</button>
      </div>
    </div>
  );
}
