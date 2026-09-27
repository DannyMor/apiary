import { useApiary } from "../hooks";
import { cssOf } from "../lib/color";
import { REGION_SIZE } from "../lib/hex";
import type { Layout } from "../lib/layout";

const W = 180, H = 140;
const hexPts = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => { const t = (k * Math.PI) / 3; return `${(cx + r * Math.sin(t)).toFixed(1)},${(cy + r * Math.cos(t)).toFixed(1)}`; }).join(" ");

export function Minimap({ layout }: { layout: Layout }) {
  const groups = useApiary((s) => s.groups);
  const groupOrder = useApiary((s) => s.groupOrder);
  const focusGroup = useApiary((s) => s.focusGroup);
  const target = useApiary((s) => s.cameraTarget);
  const requestCamera = useApiary((s) => s.requestCamera);
  const gs = groupOrder.map((g) => groups[g]).filter((g) => g && layout.centers.has(g.id));
  if (!gs.length) return <div id="minimap" />;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of gs) { const c = layout.centers.get(g.id)!; minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z); }
  const pad = REGION_SIZE * 1.1, sc = Math.min(W / (maxX - minX + 2 * pad), H / (maxZ - minZ + 2 * pad));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc, oz = (H - (maxZ - minZ) * sc) / 2 - minZ * sc;
  return (
    <div id="minimap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of session groups">
        {gs.map((g) => {
          const c = layout.centers.get(g.id)!, cx = c.x * sc + ox, cy = c.z * sc + oz, r = REGION_SIZE * 0.92 * sc;
          const fill = g.kind === "repo" ? cssOf(g.color) : cssOf({ l: 0.72, c: 0.02, h: 0 });
          return (
            <g key={g.id}>
              <polygon points={hexPts(cx, cy, r)} fill={fill} className={focusGroup === g.id ? "focus" : ""} onClick={() => requestCamera({ kind: "group", gid: g.id })}><title>{g.name}</title></polygon>
              <text x={cx.toFixed(1)} y={(cy + 2.5).toFixed(1)}>{g.name.length > 12 ? g.name.slice(0, 11) + "…" : g.name}</text>
            </g>
          );
        })}
        <circle className="cam" cx={(target.x * sc + ox).toFixed(1)} cy={(target.z * sc + oz).toFixed(1)} r="3.5" />
      </svg>
    </div>
  );
}
