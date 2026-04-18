import type { ContentCaptureOptions, PageSnapshot } from "../types/messages";

/** True only when the URL is known and cannot run extension content scripts. */
export function isHostileExtensionUrl(url: string | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.startsWith("chrome://")) return true;
  if (u.startsWith("chrome-extension://")) return true;
  if (u.startsWith("edge://")) return true;
  if (u.startsWith("about:")) return true;
  if (u.startsWith("devtools://")) return true;
  if (u.startsWith("view-source:")) return true;
  if (u.startsWith("https://chrome.google.com/webstore") || u.startsWith("https://chromewebstore.google.com/"))
    return true;
  if (u.startsWith("https://microsoftedge.microsoft.com/addons")) return true;
  if (u.startsWith("moz-extension://")) return true;
  return false;
}

export function friendlyTabError(raw: string, tabUrl?: string): string {
  const m = raw.toLowerCase();
  const connectionFailed =
    m.includes("receiving end does not exist") || m.includes("could not establish connection");
  if (connectionFailed) {
    if (isHostileExtensionUrl(tabUrl)) {
      return "This tab can’t be read—built-in browser pages, the Web Store, and some viewers block extensions. Switch to a normal website (https) and try again.";
    }
    return "The page wasn’t linked to the extension yet. Refresh the tab, wait for it to finish loading, then try again—or reopen the side panel.";
  }
  return raw;
}

function sendMessageToTab(tabId: number, message: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function parseCaptureResponse(res: unknown): PageSnapshot {
  const r = res as { ok?: boolean; snapshot?: PageSnapshot; error?: string };
  if (!r?.ok) throw new Error(r?.error || "Could not read this page.");
  return r.snapshot as PageSnapshot;
}

function buildCaptureMessage(opts: ContentCaptureOptions) {
  return {
    type: "PAGE_TUTOR_CAPTURE" as const,
    scrollBeforeCapture: opts.scrollBeforeCapture,
    scrollMaxMs: opts.scrollMaxMs,
    scrollMaxViewportHeights: opts.scrollMaxViewportHeights,
    maxTextChars: opts.maxTextChars,
    maxInlineImages: opts.maxInlineImages,
  };
}

/**
 * Ask the content script to capture; if it never loaded (SPA refresh, timing), inject `content.js` once and retry.
 * Unknown/missing tab URL is allowed (Chrome may omit `url` briefly)—we only block known hostile URLs.
 */
export async function captureFromTabWithRecovery(
  tabId: number,
  tabUrl: string | undefined,
  opts: ContentCaptureOptions,
): Promise<PageSnapshot> {
  if (isHostileExtensionUrl(tabUrl)) {
    throw new Error(
      "This tab can’t be read—built-in browser pages, the Web Store, and some viewers block extensions. Open a normal https page.",
    );
  }

  const msg = buildCaptureMessage(opts);
  const runOnce = async () => parseCaptureResponse(await sendMessageToTab(tabId, msg));

  try {
    return await runOnce();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const friendly = friendlyTabError(raw, tabUrl);
    const retriable =
      raw.toLowerCase().includes("receiving end does not exist") ||
      raw.toLowerCase().includes("could not establish connection");
    if (!retriable) throw new Error(friendly);

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await new Promise((r) => setTimeout(r, 150));
      return await runOnce();
    } catch (injectErr) {
      const extra = injectErr instanceof Error ? injectErr.message : String(injectErr);
      const blocked = extra.toLowerCase().includes("cannot access") || extra.includes("No tab");
      throw new Error(
        friendly + (blocked ? " If this keeps happening, the site may block extension scripts." : ""),
      );
    }
  }
}
