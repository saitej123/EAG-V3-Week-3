import { sendAuditToTab } from "./auditTab";
import { isHostileExtensionUrl } from "./tabCapture";

const DEFAULT_SETTLE_MS = 420;
/** ~18% overlap between adjacent viewport captures so the model sees continuity. */
const STRIP_OVERLAP_RATIO = 0.18;

function extractBase64(dataUrl: string): string | null {
  if (typeof dataUrl !== "string" || !dataUrl.includes(",")) return null;
  return dataUrl.split(",")[1] || null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type FullPageCaptureOptions = {
  maxStrips?: number;
  settleMs?: number;
};

export type VlmBeginMetrics = {
  kind: string;
  scrollHeight: number;
  viewportH: number;
  viewportW: number;
  primary: number;
};

export type VlmSavedScroll = {
  winX: number;
  winY: number;
  elScrollTop: number | null;
  elScrollLeft: number | null;
};

/**
 * Scroll offsets for tiled capture (window.scrollY or inner scroller scrollTop).
 */
export function scrollPositionsForTiledCapture(
  scrollHeight: number,
  innerHeight: number,
  maxStrips: number,
): number[] {
  const ih = Math.max(1, innerHeight);
  const maxStripsClamped = Math.max(2, Math.min(32, Math.floor(maxStrips)));
  const bottom = Math.max(0, scrollHeight - ih);
  if (bottom <= 8) return [0];

  const minStepForOverlap = Math.max(32, Math.floor(ih * (1 - STRIP_OVERLAP_RATIO)));
  const maxStep = Math.max(minStepForOverlap, ih - 2);

  function buildWithStep(step: number): number[] {
    const ys: number[] = [];
    for (let y = 0; y <= bottom; y += step) {
      ys.push(Math.min(Math.round(y), bottom));
    }
    if (ys[ys.length - 1] !== bottom) ys.push(bottom);
    return [...new Set(ys)].sort((a, b) => a - b);
  }

  let step = minStepForOverlap;
  let positions = buildWithStep(step);
  while (positions.length > maxStripsClamped && step < maxStep) {
    step = Math.min(maxStep, Math.floor(step * 1.15));
    positions = buildWithStep(step);
  }

  if (positions.length <= maxStripsClamped) return positions;

  const out: number[] = [];
  const n = positions.length;
  for (let i = 0; i < maxStripsClamped; i++) {
    const idx = Math.round((i * (n - 1)) / Math.max(1, maxStripsClamped - 1));
    out.push(positions[idx]!);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Tiled JPEG strips via async content-script scroll + rAF settle, then restore scroll.
 * Falls back to a single visible-tab capture if messaging fails.
 */
export async function captureFullPageJpegStrips(
  windowId: number,
  tabId: number,
  tabUrl: string | undefined,
  quality: number,
  opts?: FullPageCaptureOptions,
): Promise<string[]> {
  if (isHostileExtensionUrl(tabUrl)) return [];

  const maxStrips = opts?.maxStrips ?? 20;
  const settleMs = opts?.settleMs ?? DEFAULT_SETTLE_MS;

  const strips: string[] = [];
  let savedForRestore: VlmSavedScroll | undefined;

  try {
    const begin = (await sendAuditToTab(tabId, tabUrl, {
      type: "AUDIT_VLM_BEGIN",
    })) as {
      ok?: boolean;
      metrics?: VlmBeginMetrics;
      saved?: VlmSavedScroll;
      error?: string;
    };

    if (!begin?.ok || !begin.metrics || !begin.saved) {
      throw new Error(begin?.error || "VLM_BEGIN failed");
    }

    savedForRestore = begin.saved;
    const m = begin.metrics;
    const sh = m.scrollHeight;
    const ih = Math.max(1, m.viewportH);
    const positions = sh <= ih + 12 ? [0] : scrollPositionsForTiledCapture(sh, ih, maxStrips);

    for (const offset of positions) {
      const go = (await sendAuditToTab(tabId, tabUrl, {
        type: "AUDIT_VLM_GOTO",
        offset,
        settleMs,
      })) as { ok?: boolean };
      if (!go?.ok) throw new Error("VLM_GOTO failed");

      await delay(40);
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality });
      const b64 = extractBase64(dataUrl);
      if (b64) strips.push(b64);
    }

    await sendAuditToTab(tabId, tabUrl, {
      type: "AUDIT_VLM_RESTORE",
      saved: begin.saved,
    });
    await delay(100);
  } catch {
    if (savedForRestore) {
      try {
        await sendAuditToTab(tabId, tabUrl, {
          type: "AUDIT_VLM_RESTORE",
          saved: savedForRestore,
        });
      } catch {
        /* ignore */
      }
    }
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality });
      const b64 = extractBase64(dataUrl);
      if (b64) strips.push(b64);
    } catch {
      /* ignore */
    }
  }

  return strips;
}
