import { useEffect, useMemo, useState } from "react";
import { useApiary } from "../../hooks";
import { useCustomTags, useSelectedSessions } from "../../derived";
import { cssOf, fmtColor, suggestColors, type Oklch } from "../../lib/color";
import { AUTO_NAMES, AUTO_TAGS, tagsOf } from "../../lib/sections";
import type { Session } from "../../model";
import { ColorPicker, type Named } from "./ColorPicker";
import { Modal } from "./Modal";

const WORLD_PRESETS = { bright: "#f4f6f8", dark: "#182230" };

export function Dialogs() {
  const dialog = useApiary((s) => s.dialog);
  const closeDialog = useApiary((s) => s.closeDialog);
  const clearSelection = useApiary((s) => s.clearSelection);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (dialog) closeDialog(); else clearSelection(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, closeDialog, clearSelection]);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "swarm": return <SwarmDialog gid={dialog.gid} />;
    case "labels": return <LabelsDialog />;
    case "world": return <WorldDialog />;
    case "honey": return <HoneyDialog id={dialog.id} />;
    case "purge": return <PurgeDialog id={dialog.id} />;
    case "summarize": return <SummarizeDialog id={dialog.id} />;
    case "color": return <ColorDialog gid={dialog.gid} />;
  }
}

function useOthers(except: string | null): Named[] {
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  return useMemo(() => groupOrder.filter((g) => g !== except).map((g) => ({ ...groups[g].color, name: groups[g].name })), [groups, groupOrder, except]);
}

function SwarmDialog({ gid }: { gid: string | null }) {
  const g = useApiary((s) => (gid ? s.groups[gid] : undefined));
  const sessions = useApiary((s) => s.sessions);
  const groups = useApiary((s) => s.groups);
  const closeDialog = useApiary((s) => s.closeDialog);
  const clearSelection = useApiary((s) => s.clearSelection);
  const createSwarm = useApiary((s) => s.createSwarm);
  const updateGroup = useApiary((s) => s.updateGroup);
  const addMembers = useApiary((s) => s.addMembers);
  const removeMember = useApiary((s) => s.removeMember);
  const deleteGroup = useApiary((s) => s.deleteGroup);
  const requestCamera = useApiary((s) => s.requestCamera);
  const showToast = useApiary((s) => s.showToast);
  const selected = useSelectedSessions();
  const tags = useCustomTags();
  const others = useOthers(gid);
  const live = useMemo(() => Object.values(sessions).filter((s) => s.status !== "archived"), [sessions]);
  const [name, setName] = useState(g?.name ?? "");
  const [members, setMembers] = useState<Set<string>>(() => new Set(g ? live.filter((s) => gid && s.swarms.includes(gid)).map((s) => s.id) : selected.map((s) => s.id)));
  const [color, setColor] = useState<Oklch>(() => g?.color ?? suggestColors(others, 1)[0]);
  const [busy, setBusy] = useState(false);
  const bySource = (src: string): Session[] => src === "selected" ? selected : live.filter((s) => tagsOf(s).includes(src.slice(4)));
  const toggleSource = (src: string) => {
    const l = bySource(src), all = l.length > 0 && l.every((s) => members.has(s.id));
    const next = new Set(members); for (const s of l) if (all) next.delete(s.id); else next.add(s.id); setMembers(next);
  };
  const list = [...members].map((id) => sessions[id]).filter((s): s is Session => !!s).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const commit = async () => {
    const finalName = name.trim() || g?.name || "Untitled swarm";
    setBusy(true);
    try {
      let id = gid;
      if (!g) id = await createSwarm(finalName, fmtColor(color), [...members]);
      else {
        await updateGroup(gid!, { name: finalName, color: fmtColor(color) });
        const current = new Set(live.filter((s) => s.swarms.includes(gid!)).map((s) => s.id));
        const add = [...members].filter((x) => !current.has(x)), drop = [...current].filter((x) => !members.has(x));
        if (add.length) await addMembers(gid!, add);
        for (const sid of drop) await removeMember(gid!, sid);
      }
      closeDialog(); clearSelection(); if (id) requestCamera({ kind: "group", gid: id });
      showToast(g ? `Saved ${finalName}` : members.size ? `Created ${finalName} with ${members.size}` : `Created ${finalName}`);
    } catch { setBusy(false); }
  };
  const dissolve = async () => { try { await deleteGroup(gid!); closeDialog(); requestCamera({ kind: "overview" }); showToast(`Dissolved ${g?.name}, sessions returned home`); } catch { /* toasted */ } };
  return (
    <Modal title={g ? "Edit swarm" : "New swarm"}>
      <div className="field"><span>Swarm name (a task force, a customer, an epic): cells from any hive, in one place</span>
        <input type="text" placeholder="e.g. Billing migration" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void commit(); }} /></div>
      <div className="field"><span>Add or remove by</span>
        <div className="chips">
          {selected.length > 0 && <button className={selected.every((s) => members.has(s.id)) ? "on" : ""} onClick={() => toggleSource("selected")}>Selected ({selected.length})</button>}
          {Object.keys(AUTO_TAGS).map((k) => { const l = bySource(`tag:${k}`); return <button key={k} className={`auto ${l.length && l.every((s) => members.has(s.id)) ? "on" : ""}`} onClick={() => toggleSource(`tag:${k}`)}>{AUTO_NAMES[k]}</button>; })}
          {tags.map((t) => { const l = bySource(`tag:${t}`); return <button key={t} className={l.length && l.every((s) => members.has(s.id)) ? "on" : ""} onClick={() => toggleSource(`tag:${t}`)}>{t}</button>; })}
        </div>
      </div>
      <div className="field"><span>{list.length ? `${list.length} member${list.length === 1 ? "" : "s"}` : "No members yet. Add by label or selection, or create it empty and fill it later."}</span>
        <div className="members">{list.map((s) => <span key={s.id} className="member" style={{ "--rowc": cssOf(groups[s.repo]?.color ?? color) } as React.CSSProperties}><i />{s.title}<button title="Remove" onClick={() => { const n = new Set(members); n.delete(s.id); setMembers(n); }}>×</button></span>)}</div>
      </div>
      <div className="field"><span>Swarm color on the map. Cells keep their hive's color.</span><ColorPicker initial={color} others={others} onChange={setColor} /></div>
      <div className="actions">
        {g && <button className="btn danger" style={{ marginRight: "auto" }} onClick={() => void dissolve()}>Dissolve swarm</button>}
        <button className="btn" onClick={closeDialog}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void commit()}>{g ? "Save changes" : list.length ? `Create with ${list.length}` : "Create empty swarm"}</button>
      </div>
    </Modal>
  );
}

function LabelsDialog() {
  const sel = useSelectedSessions();
  const tags = useCustomTags();
  const addTag = useApiary((s) => s.addTag);
  const removeTag = useApiary((s) => s.removeTag);
  const closeDialog = useApiary((s) => s.closeDialog);
  const [draft, setDraft] = useState("");
  const toggle = async (t: string) => {
    const all = sel.every((s) => s.tags.includes(t));
    await Promise.all(sel.map((s) => (all ? (s.tags.includes(t) ? removeTag(s.id, t) : Promise.resolve()) : (s.tags.includes(t) ? Promise.resolve() : addTag(s.id, t))))).catch(() => undefined);
  };
  const add = async () => {
    const t = draft.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (!t || AUTO_TAGS[t]) return;
    setDraft("");
    await Promise.all(sel.filter((s) => !s.tags.includes(t)).map((s) => addTag(s.id, t))).catch(() => undefined);
  };
  return (
    <Modal title={`Labels for ${sel.length} session${sel.length === 1 ? "" : "s"}`}>
      <div className="field"><span>Click a label to apply it to all selected; click again to remove it from all.</span>
        <div className="chips">{tags.length ? tags.map((t) => { const n = sel.filter((s) => s.tags.includes(t)).length; return <button key={t} className={n === sel.length ? "on" : ""} title={`${n} of ${sel.length} selected have this`} onClick={() => void toggle(t)}>{t}{n && n < sel.length ? <span style={{ color: "var(--muted)" }}> {n}/{sel.length}</span> : null}</button>; }) : <span style={{ fontSize: 12, color: "var(--muted)" }}>No labels yet. Create one below.</span>}</div>
      </div>
      <div className="field"><span>New label</span><div className="tagedit"><input type="text" placeholder="e.g. billing, needs-review, keep" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} /><button className="btn primary" onClick={() => void add()}>Add</button></div></div>
      <div className="actions"><button className="btn primary" onClick={closeDialog}>Done</button></div>
    </Modal>
  );
}

function WorldDialog() {
  const world = useApiary((s) => s.world);
  const setWorld = useApiary((s) => s.setWorld);
  const closeDialog = useApiary((s) => s.closeDialog);
  return (
    <Modal title="World color">
      <div className="field"><span>The floor and sky share one color.</span>
        <div className="wopts">
          <button className="btn" onClick={() => setWorld(WORLD_PRESETS.bright)}>Bright</button>
          <button className="btn" onClick={() => setWorld(WORLD_PRESETS.dark)}>Dark</button>
          <label className="btn" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>Custom <input type="color" value={world} onChange={(e) => setWorld(e.target.value)} /></label>
        </div>
      </div>
      <div className="actions"><button className="btn primary" onClick={closeDialog}>Done</button></div>
    </Modal>
  );
}

function HoneyDialog({ id }: { id: string }) {
  const s = useApiary((st) => st.sessions[id]);
  const honey = useApiary((st) => st.honey);
  const closeDialog = useApiary((st) => st.closeDialog);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { honey(id).then(setText).catch(() => setText("(no honey)")); }, [id, honey]);
  return (
    <Modal title={`Honey: ${s?.title ?? id}`}>
      <pre style={{ whiteSpace: "pre-wrap", maxHeight: "60vh", overflow: "auto" }}>{text ?? "…"}</pre>
      <div className="actions"><button className="btn primary" onClick={closeDialog}>Done</button></div>
    </Modal>
  );
}

function PurgeDialog({ id }: { id: string }) {
  const s = useApiary((st) => st.sessions[id]);
  const purge = useApiary((st) => st.purge);
  const closeDialog = useApiary((st) => st.closeDialog);
  const showToast = useApiary((st) => st.showToast);
  return (
    <Modal title={`Purge ${s?.title ?? id}?`}>
      <div className="field"><span>The archived transcript is deleted for good. {s?.hasHoney ? "The honey stays." : "There is no honey for it."}</span></div>
      <div className="actions"><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn danger" onClick={() => { closeDialog(); purge(id).then(() => showToast(`Purged ${s?.title ?? id}`)).catch(() => undefined); }}>Purge</button></div>
    </Modal>
  );
}

function SummarizeDialog({ id }: { id: string }) {
  const decide = useApiary((st) => st.decide);
  const closeDialog = useApiary((st) => st.closeDialog);
  const showToast = useApiary((st) => st.showToast);
  return (
    <Modal title="Honey: summarize, then archive">
      <div className="field"><span>When marks are applied the keeper writes a Markdown summary of this session with <code>claude -p</code>, keeps it next to the archived transcript, and moves the transcript out of Claude's session list. Restore brings it back.</span></div>
      <div className="actions"><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={() => { closeDialog(); decide(id, "summarize_archive").then(() => showToast("Marked for the keeper: summarize and archive")).catch(() => undefined); }}>Mark: summarize and archive</button></div>
    </Modal>
  );
}

function ColorDialog({ gid }: { gid: string }) {
  const g = useApiary((st) => st.groups[gid]);
  const updateGroup = useApiary((st) => st.updateGroup);
  const closeDialog = useApiary((st) => st.closeDialog);
  const others = useOthers(gid);
  const [color, setColor] = useState<Oklch>(g?.color ?? { l: 0.64, c: 0.21, h: 22 });
  if (!g) return null;
  return (
    <Modal title={`Color for ${g.name}`}>
      <ColorPicker initial={g.color} others={others} onChange={setColor} />
      <div className="actions"><button className="btn" onClick={closeDialog}>Cancel</button><button className="btn primary" onClick={() => updateGroup(gid, { color: fmtColor(color) }).then(closeDialog).catch(() => undefined)}>Save color</button></div>
    </Modal>
  );
}
