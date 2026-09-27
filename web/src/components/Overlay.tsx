import { useApiary } from "../hooks";

export function Overlay() {
  const lens = useApiary((s) => s.lens);
  const toast = useApiary((s) => s.toast);
  const conn = useApiary((s) => s.conn);
  const loadError = useApiary((s) => s.loadError);
  const requestCamera = useApiary((s) => s.requestCamera);
  const openDialog = useApiary((s) => s.openDialog);
  return (
    <>
      <div id="legend">
        <b id="legend-title">{lens === "score" ? "Height: keep score" : "Height: recency"}</b>
        <span>Each hive is a repo, each cell a session</span><span>Tall and vivid: touched recently</span>
        <span>Low and grey: idle for weeks</span><span>Glowing: running now</span><span>Faint outline: on loan to a swarm</span>
      </div>
      <div id="camctl">
        <button onClick={() => requestCamera({ kind: "top" })} title="Straight down, like the map"><svg viewBox="0 0 16 16"><path d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7z" /></svg>Top</button>
        <button onClick={() => requestCamera({ kind: "overview" })} title="Angled view of every region"><svg viewBox="0 0 16 16"><path d="M1.5 11.5L8 8l6.5 3.5M8 8V2.5M3 5.5l5-3 5 3" /></svg>Overview</button>
        <button id="worldcolor" title="World color" style={{ flex: "0 0 36px" }} onClick={() => openDialog({ kind: "world" })}><span className="wdot" /></button>
      </div>
      <div id="hud">
        {loadError
          ? `Could not load from the Apiary daemon (${loadError}). Is \`apiary serve\` running?`
          : "Drag to orbit, right-drag or shift-drag to pan, wheel to zoom. Click a cell to focus it, shift-click to select several, double-click a cell to open it in Claude, double-click empty space to see the whole apiary."}
      </div>
      <div id="toast" className={toast ? "on" : ""}>{toast}</div>
      <div id="conn" className={conn === "live" ? "" : "off"}>{conn === "live" ? "live" : conn === "offline" ? "reconnecting…" : "connecting…"}</div>
    </>
  );
}
