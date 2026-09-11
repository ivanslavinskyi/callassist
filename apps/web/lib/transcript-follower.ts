import { isNearTranscriptBottom } from "./transcript-scroll";

/** Follow is user intent. Content growth and our own scroll events cannot switch it off. */
export function createTranscriptFollower(list: HTMLElement, onChange: (following: boolean) => void) {
  let following = true;
  let frame = 0;
  let expectedTop: number | null = null;
  let manualUntil = 0;
  let dragging = false;
  let touchY: number | null = null;
  const setFollowing = (next: boolean) => {
    if (following !== next) { following = next; onChange(next); }
  };
  const refresh = () => {
    if (frame || !following) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!following || !list.isConnected || list.clientHeight === 0) return;
      // Instant coalesced updates avoid chasing a stale smooth-scroll destination.
      list.scrollTop = list.scrollHeight;
      expectedTop = list.scrollTop;
    });
  };
  const manual = () => { manualUntil = performance.now() + 1000; expectedTop = null; };
  const onScroll = () => {
    if (expectedTop !== null && Math.abs(list.scrollTop - expectedTop) < 1) return;
    if (dragging || performance.now() < manualUntil) {
      setFollowing(isNearTranscriptBottom(list));
      if (following) refresh();
    }
  };
  const onWheel = (event: WheelEvent) => { manual(); if (event.deltaY < 0) setFollowing(false); };
  const onPointerDown = () => { dragging = true; manual(); };
  const onPointerUp = () => { dragging = false; };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; manual(); };
  const onTouchMove = (event: TouchEvent) => {
    const next = event.touches[0]?.clientY;
    if (next === undefined) return;
    manual();
    if (touchY !== null && next > touchY) setFollowing(false);
    touchY = next;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
    manual();
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) setFollowing(false);
  };
  const resize = new ResizeObserver(refresh);
  const observeSize = () => {
    resize.disconnect(); resize.observe(list);
    for (const child of list.children) resize.observe(child);
    refresh();
  };
  const mutation = new MutationObserver(observeSize);
  mutation.observe(list, { childList: true, subtree: true, characterData: true });
  observeSize();
  list.addEventListener("scroll", onScroll, { passive: true });
  list.addEventListener("wheel", onWheel, { passive: true });
  list.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  list.addEventListener("touchstart", onTouchStart, { passive: true });
  list.addEventListener("touchmove", onTouchMove, { passive: true });
  list.addEventListener("keydown", onKeyDown);
  return {
    refresh,
    follow() { manualUntil = 0; setFollowing(true); refresh(); },
    destroy() {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      list.removeEventListener("scroll", onScroll); list.removeEventListener("wheel", onWheel);
      list.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp); list.removeEventListener("touchstart", onTouchStart);
      list.removeEventListener("touchmove", onTouchMove); list.removeEventListener("keydown", onKeyDown);
    }
  };
}
