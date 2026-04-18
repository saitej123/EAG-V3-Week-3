/** Viewport screenshot for Gemini VLM (what the user actually sees). */
export async function captureViewportJpegBase64(quality = 72): Promise<string | null> {
  try {
    const win = await chrome.windows.getLastFocused();
    const windowId = win.id;
    if (windowId == null) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality });
    if (typeof dataUrl !== "string" || !dataUrl.includes(",")) return null;
    return dataUrl.split(",")[1] || null;
  } catch {
    return null;
  }
}
