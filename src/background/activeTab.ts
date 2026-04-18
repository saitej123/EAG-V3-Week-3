const selfOrigin = () => chrome.runtime.getURL("");

function isOurExtensionPage(url: string | undefined): boolean {
  return !!url && url.startsWith(selfOrigin());
}

function looksLikeWebPage(tab: chrome.tabs.Tab): boolean {
  const u = (tab.url || tab.pendingUrl || "").toLowerCase();
  if (!u) return false;
  return (
    u.startsWith("http://") ||
    u.startsWith("https://") ||
    u.startsWith("file://") ||
    u.startsWith("ftp://")
  );
}

/**
 * Picks the tab whose content we should read. Skips FairFrame’s own extension pages (side panel / options)
 * so we don’t run on chrome-extension://… when that tab is “active”.
 */
export async function getTargetTabForCapture(): Promise<chrome.tabs.Tab> {
  const win = await chrome.windows.getLastFocused({ populate: true });
  if (!win?.tabs?.length) {
    throw new Error("No browser window found.");
  }

  const webTabs = win.tabs.filter(
    (t) =>
      t.id &&
      looksLikeWebPage(t) &&
      !isOurExtensionPage(t.url) &&
      !isOurExtensionPage(t.pendingUrl),
  );
  const activeWeb = webTabs.find((t) => t.active);
  if (activeWeb) return activeWeb;
  if (webTabs[0]) return webTabs[0];

  for (const q of [{ active: true, lastFocusedWindow: true }, { active: true, currentWindow: true }] as const) {
    const [t] = await chrome.tabs.query(q);
    if (
      t?.id &&
      looksLikeWebPage(t) &&
      !isOurExtensionPage(t.url) &&
      !isOurExtensionPage(t.pendingUrl)
    )
      return t;
  }

  throw new Error(
    "No website tab found in this window. Focus the page you want to check, then open the side panel again.",
  );
}
