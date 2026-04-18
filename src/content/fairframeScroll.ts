/**
 * Detect window vs primary overflow scroll container (SPA / app shells) and drive both consistently.
 */

type ScrollCache = {
  kind: "window" | "element";
  el: HTMLElement | null;
};

let scrollCache: ScrollCache | null = null;

export function resetFairFrameScrollSession(): void {
  scrollCache = null;
}

function ensureScrollCache(): ScrollCache {
  if (scrollCache) return scrollCache;

  const docEl = document.documentElement;
  const body = document.body;
  const docH = Math.max(
    docEl.scrollHeight,
    body?.scrollHeight ?? 0,
    docEl.offsetHeight,
  );

  if (docH > window.innerHeight + 52) {
    scrollCache = { kind: "window", el: null };
    return scrollCache;
  }

  let best: HTMLElement | null = null;
  let bestArea = 0;
  document.querySelectorAll("body *").forEach((node) => {
    const el = node as HTMLElement;
    const st = getComputedStyle(el);
    if (st.overflowY !== "auto" && st.overflowY !== "scroll") return;
    if (el.scrollHeight <= el.clientHeight + 36) return;
    const a = el.clientWidth * el.clientHeight;
    if (a > bestArea) {
      best = el;
      bestArea = a;
    }
  });

  if (best) {
    scrollCache = { kind: "element", el: best };
    return scrollCache;
  }

  scrollCache = { kind: "window", el: null };
  return scrollCache;
}

export type FairFrameScrollMetrics = {
  kind: "window" | "element";
  scrollHeight: number;
  viewportH: number;
  viewportW: number;
  primary: number;
  secondary: number;
};

export function readScrollMetrics(): FairFrameScrollMetrics {
  const c = ensureScrollCache();
  if (c.kind === "window" || !c.el) {
    const root = document.scrollingElement || document.documentElement;
    const sh = Math.max(
      root.scrollHeight,
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      document.documentElement.offsetHeight,
    );
    return {
      kind: "window",
      scrollHeight: sh,
      viewportH: window.innerHeight,
      viewportW: window.innerWidth,
      primary: window.scrollY,
      secondary: window.scrollX,
    };
  }
  const el = c.el;
  return {
    kind: "element",
    scrollHeight: el.scrollHeight,
    viewportH: el.clientHeight,
    viewportW: el.clientWidth,
    primary: el.scrollTop,
    secondary: el.scrollLeft,
  };
}

export function setPrimaryScroll(offset: number): void {
  const c = ensureScrollCache();
  if (c.kind === "window" || !c.el) {
    window.scrollTo({ left: window.scrollX, top: offset, behavior: "instant" } as ScrollToOptions);
    const root = document.scrollingElement || document.documentElement;
    try {
      root.scrollTop = offset;
    } catch {
      /* ignore */
    }
  } else {
    c.el.scrollTop = offset;
  }
}

export type FairFrameSavedScroll = {
  winX: number;
  winY: number;
  elScrollTop: number | null;
  elScrollLeft: number | null;
};

export function saveScrollState(): FairFrameSavedScroll {
  ensureScrollCache();
  const el = scrollCache?.el ?? null;
  return {
    winX: window.scrollX,
    winY: window.scrollY,
    elScrollTop: el ? el.scrollTop : null,
    elScrollLeft: el ? el.scrollLeft : null,
  };
}

export function restoreScrollState(s: FairFrameSavedScroll): void {
  ensureScrollCache();
  const el = scrollCache?.el ?? null;
  window.scrollTo({ left: s.winX, top: s.winY, behavior: "instant" } as ScrollToOptions);
  try {
    (document.scrollingElement || document.documentElement).scrollTop = s.winY;
    (document.scrollingElement || document.documentElement).scrollLeft = s.winX;
  } catch {
    /* ignore */
  }
  if (scrollCache?.kind === "element" && el && s.elScrollTop != null) {
    el.scrollTop = s.elScrollTop;
    el.scrollLeft = s.elScrollLeft ?? 0;
  }
}

function rafTwice(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Wait for layout/paint after programmatic scroll (lazy lists, images). */
export async function settleAfterScroll(settleMs: number): Promise<void> {
  const ms = Math.max(60, settleMs);
  await rafTwice();
  await new Promise((r) => setTimeout(r, ms));
  await rafTwice();
}
