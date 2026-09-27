import { useEffect, useMemo, useRef } from "react";
import { useApiary, useApiaryStore } from "../hooks";
import { computeLayout } from "../lib/layout";
import { filterActive, matchesFilter } from "../lib/sections";
import { WorldEngine } from "./engine";
import { Overlay } from "../components/Overlay";
import { Minimap } from "../components/Minimap";

const REDRAW_MS = 80;

/** Owns the engine; the store is the only input and the only output. */
export function World() {
  const store = useApiaryStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);

  const sessions = useApiary((s) => s.sessions);
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  const lens = useApiary((s) => s.lens);
  const now = useApiary((s) => s.now);
  const filter = useApiary((s) => s.filter);
  const selected = useApiary((s) => s.selected);
  const hover = useApiary((s) => s.hover);
  const world = useApiary((s) => s.world);
  const camera = useApiary((s) => s.camera);

  const live = useMemo(() => Object.values(sessions).filter((s) => s.status !== "archived"), [sessions]);
  const layout = useMemo(() => computeLayout(live, groups, groupOrder, lens, now), [live, groups, groupOrder, lens, now]);
  const shown = useMemo(() => new Set(live.filter((s) => matchesFilter(s, filter, groups, now)).map((s) => s.id)), [live, filter, groups, now]);

  useEffect(() => {
    const host = hostRef.current!, labels = labelsRef.current!;
    const engine = new WorldEngine(host, labels, {
      onPick: (id, additive) => { store.getState().select(id, additive); if (!additive) store.getState().requestCamera({ kind: "session", id }); },
      onPickPlate: (gid) => store.getState().requestCamera({ kind: "group", gid }),
      onHover: (id) => store.getState().setHover(id),
      onView: (g, s) => store.getState().setFocus(g, s, engine.cameraTarget()),
      onOpen: (id) => void store.getState().openSession(id),
    });
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(host);
    return () => { ro.disconnect(); engine.dispose(); engineRef.current = null; };
  }, [store]);

  useEffect(() => {
    const t = setTimeout(() => {
      engineRef.current?.setScene({ sessions: live, groups, groupOrder, layout, lens, now, shown, filtering: filterActive(filter) });
      engineRef.current?.setSelection(selected);
    }, REDRAW_MS);
    return () => clearTimeout(t);
  }, [live, groups, groupOrder, layout, lens, now, shown, filter, selected]);
  useEffect(() => { engineRef.current?.setSelection(selected); }, [selected]);
  useEffect(() => { engineRef.current?.setHover(hover); }, [hover]);
  useEffect(() => { engineRef.current?.setWorldColor(world); }, [world]);
  useEffect(() => {
    const e = engineRef.current, req = camera.req;
    if (!e || !req) return;
    // a rebuild may be pending: let it land first so the target has a position
    const t = setTimeout(() => {
      if (req.kind === "session") e.focusSessionView(req.id);
      else if (req.kind === "group") e.focusGroupView(req.gid);
      else if (req.kind === "overview") e.viewOverview();
      else e.viewTop();
    }, REDRAW_MS + 10);
    return () => clearTimeout(t);
  }, [camera]);

  return (
    <main id="world">
      <div className="canvas-host" ref={hostRef} />
      <div id="labels" ref={labelsRef} />
      <Minimap layout={layout} />
      <Overlay />
    </main>
  );
}
