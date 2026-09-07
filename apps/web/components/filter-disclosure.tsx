"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Keep the same form mounted; collapse filters only on compact screens. */
export function FilterDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 768px)");
    const sync = () => { if (ref.current) ref.current.open = desktop.matches; };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);
  return <details className="admin-filter-disclosure" ref={ref}>
    <summary>{label}</summary>{children}
  </details>;
}
