import { useEffect, useRef, useState } from "react";
import { cssOf, deltaE, lin2srgb, oklchToLinear, suggestColors, type Oklch } from "../../lib/color";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export type Named = Oklch & { name: string };

/** Hue across, chroma up, lightness on a slider; suggestions clear of the other groups' colors. */
export function ColorPicker({ initial, others, onChange }: { initial: Oklch; others: Named[]; onChange: (c: Oklch) => void }) {
  const [col, setCol] = useState<Oklch>(initial);
  const [sugg] = useState(() => suggestColors(others, 4));
  const cv = useRef<HTMLCanvasElement>(null);
  const down = useRef(false);
  const set = (c: Oklch) => { setCol(c); onChange(c); };
  useEffect(() => {
    const c = cv.current!, ctx = c.getContext("2d")!, W = c.width, H = c.height, img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = (x / W) * 360, ch = (1 - y / H) * 0.32, rgb = oklchToLinear(col.l, ch, h);
      const ok = rgb.every((v) => v >= -0.002 && v <= 1.002), out = ok ? rgb : oklchToLinear(col.l, 0, h), o = (y * W + x) * 4;
      img.data[o] = lin2srgb(clamp(out[0], 0, 1)) * 255; img.data[o + 1] = lin2srgb(clamp(out[1], 0, 1)) * 255; img.data[o + 2] = lin2srgb(clamp(out[2], 0, 1)) * 255; img.data[o + 3] = ok ? 255 : 90;
    }
    ctx.putImageData(img, 0, 0);
    const px = (col.h / 360) * W, py = (1 - col.c / 0.32) * H;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1; ctx.stroke();
  }, [col]);
  const fromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set({ l: col.l, h: clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360, c: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * 0.32 });
  };
  let nearest: { name: string; d: number } | null = null;
  for (const o of others) { const d = deltaE(col, o); if (!nearest || d < nearest.d) nearest = { name: o.name, d }; }
  return (
    <div className="picker">
      <div className="sugg"><span>Suggested</span>{sugg.map((c, i) => <button key={i} className={Math.abs(c.h - col.h) < 1 && Math.abs(c.c - col.c) < 0.005 ? "on" : ""} style={{ background: cssOf(c) }} title={`oklch(${c.l.toFixed(2)} ${c.c.toFixed(2)} ${Math.round(c.h)})`} onClick={() => set({ ...c })} />)}</div>
      <canvas ref={cv} width={180} height={90} onPointerDown={(e) => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); fromEvent(e); }} onPointerMove={(e) => { if (down.current) fromEvent(e); }} onPointerUp={() => { down.current = false; }} />
      <div className="lrow"><span style={{ fontSize: 12, color: "var(--muted)" }}>Lightness</span><input type="range" min="0.35" max="0.9" step="0.005" value={col.l} onChange={(e) => set({ ...col, l: parseFloat(e.target.value) })} /></div>
      <div className="prev"><div className="sw" style={{ background: cssOf(col) }} /><div className="txt"><b>{`oklch(${col.l.toFixed(2)} ${col.c.toFixed(2)} ${Math.round(col.h)})`}</b>
        <span className={nearest && nearest.d < 12 ? "warn" : ""}>{nearest ? `Closest existing: ${nearest.name}, distance ${nearest.d.toFixed(0)}` : "First group, any color works."}</span></div></div>
    </div>
  );
}
