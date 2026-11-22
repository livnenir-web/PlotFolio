import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Tip {
  text: string;
  x: number;
  y: number;
  above: boolean;
}

const DELAY_MS = 450;
const HALF_WIDTH = 140; // half of the largest width a tip takes (see .tip in styles.css)

/**
 * Explanations on hover, for the whole window: any element with a `title` (or a `data-tip`) shows its text in the
 * app's own tooltip after a short pause. The `title` is moved to `data-tip` on first hover so the system's slower
 * tooltip does not appear as well; elements without text of their own keep it as their accessible name.
 * Mount once per window.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const el = target instanceof Element ? (target.closest("[title], [data-tip]") as HTMLElement | null) : null;
      if (el === current) return;
      hide();
      if (!el || !(el instanceof HTMLElement)) return;
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-tip", title);
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
      }
      const text = el.getAttribute("data-tip");
      if (!text) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const above = r.bottom + 60 > window.innerHeight;
        const x = Math.min(Math.max(r.left + r.width / 2, HALF_WIDTH + 6), window.innerWidth - HALF_WIDTH - 6);
        setTip({ text, x, y: above ? r.top - 6 : r.bottom + 6, above });
      }, DELAY_MS);
    };
    const leave = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", leave);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div className={"tip" + (tip.above ? " above" : "")} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}

/** A small "i" that shows an explanation on hover: for text that explains a whole section rather than one control. */
export function Info({ text }: { text: string }) {
  return (
    <span className="info-mark" data-tip={text} aria-label={text} onClick={(e) => e.stopPropagation()}>
      i
    </span>
  );
}
