"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UiIcon } from "./ui-icon";

export function NavigationMenu({ children, id, label, openLabel, closeLabel, mobile = false }: {
  children: ReactNode; id: string; label: string; openLabel: string; closeLabel: string; mobile?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details className={`navigation-menu ${mobile ? "mobile-menu" : "more-menu"}`} ref={ref}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className={mobile ? "icon-button" : undefined} aria-expanded={open} aria-controls={id}
      aria-label={mobile ? open ? closeLabel : openLabel : undefined} title={mobile ? open ? closeLabel : openLabel : undefined}>
      {mobile ? <><UiIcon name="bars-3" className="menu-closed-icon" /><UiIcon name="x-mark" className="menu-open-icon" /></> : label}
    </summary>
    <nav id={id} aria-label={label} onClick={(event) => {
      if ((event.target as HTMLElement).closest("a,button") && ref.current) ref.current.open = false;
    }}>{children}</nav>
  </details>;
}
