import { useCallback, useEffect, useRef, useState } from 'react';

interface View { scale: number; x: number; y: number }
const normal: View = { scale: 1, x: 0, y: 0 };
const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export function useImageZoom() {
  const surface = useRef<HTMLDivElement>(null);
  const current = useRef<View>(normal);
  const [view, setView] = useState(normal);
  const suppressUntil = useRef(0);
  const update = useCallback((next: View) => { current.current = next; setView(next); }, []);
  const reset = useCallback(() => update(normal), [update]);
  const toggle = () => update(current.current.scale > 1 ? normal : { scale: 2, x: 0, y: 0 });

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    let start = { x: 0, y: 0 }, last = start;
    let pinch: { distance: number; scale: number; anchorX: number; anchorY: number } | undefined;
    let moved = false, interacting = false;
    const prevent = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    const constrain = (scale: number, x: number, y: number): View => ({
      scale, x: Math.max(-el.clientWidth * (scale - 1) / 2, Math.min(el.clientWidth * (scale - 1) / 2, x)),
      y: Math.max(-el.clientHeight * (scale - 1) / 2, Math.min(el.clientHeight * (scale - 1) / 2, y)),
    });
    const startPinch = (touches: TouchList) => {
      const a = touches[0], b = touches[1], rect = el.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2 - rect.left - rect.width / 2;
      const midY = (a.clientY + b.clientY) / 2 - rect.top - rect.height / 2;
      pinch = { distance: Math.max(1, distance(a, b)), scale: current.current.scale,
        anchorX: (midX - current.current.x) / current.current.scale,
        anchorY: (midY - current.current.y) / current.current.scale };
      interacting = true; moved = true;
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) { startPinch(event.touches); prevent(event); }
      else if (event.touches.length === 1) {
        start = last = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        moved = false;
        if (current.current.scale > 1) { interacting = true; prevent(event); }
      }
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        prevent(event);
        if (!pinch) startPinch(event.touches);
        const a = event.touches[0], b = event.touches[1], rect = el.getBoundingClientRect();
        const scale = Math.max(1, Math.min(4, pinch!.scale * distance(a, b) / pinch!.distance));
        update(constrain(scale,
          (a.clientX + b.clientX) / 2 - rect.left - rect.width / 2 - pinch!.anchorX * scale,
          (a.clientY + b.clientY) / 2 - rect.top - rect.height / 2 - pinch!.anchorY * scale));
      } else if (event.touches.length === 1) {
        const point = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        if (Math.hypot(point.x - start.x, point.y - start.y) > 8) moved = true;
        if (interacting || current.current.scale > 1) {
          prevent(event);
          if (current.current.scale > 1) update(constrain(current.current.scale, current.current.x + point.x - last.x, current.current.y + point.y - last.y));
        }
        last = point;
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (moved || interacting) suppressUntil.current = Date.now() + 500;
      if (event.touches.length < 2) {
        pinch = undefined;
        if (event.touches.length === 1) last = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }
      if (!event.touches.length) interacting = false;
    };
    const onCancel = (event: TouchEvent) => { reset(); onEnd(event); };
    // Non-passive handlers are needed to keep two-finger gestures on the image
    // instead of letting iOS magnify the entire document.
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onCancel);
    return () => {
      el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onCancel);
    };
  }, [update, reset]);

  return { surface, view, reset, toggle, suppressClick: () => Date.now() < suppressUntil.current,
    style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } };
}
