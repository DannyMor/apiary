import type { ReactNode } from "react";
import { useApiary } from "../../hooks";

export function Modal({ title, children }: { title: string; children: ReactNode }) {
  const closeDialog = useApiary((s) => s.closeDialog);
  return (
    <div id="modal" className="on" onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div className="dialog" role="dialog" aria-modal="true"><h3>{title}</h3>{children}</div>
    </div>
  );
}
