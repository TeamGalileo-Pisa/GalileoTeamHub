import { useEffect, useRef } from "react";

/**
 * Comportamento comune delle finestre di inserimento dati (Budget, Sponsor, Ordini):
 * Esc per chiudere, focus sul primo campo, niente scorrimento della pagina sotto.
 */
export function useModalBehavior(active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          ".sponsor-modal input:not([type=hidden]):not([disabled]), .sponsor-modal textarea:not([disabled])",
        )
        ?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
