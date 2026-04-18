import { friendlyTabError, isHostileExtensionUrl } from "./tabCapture";

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

export async function sendToTabWithInject(tabId: number, tabUrl: string | undefined, message: object): Promise<unknown> {
  if (isHostileExtensionUrl(tabUrl)) {
    throw new Error(
      "This tab can’t be checked—built-in browser pages and the Web Store block extensions. Open a normal website first.",
    );
  }

  const run = () => sendMessageToTab(tabId, message);

  try {
    return await run();
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const retriable =
      raw.toLowerCase().includes("receiving end does not exist") ||
      raw.toLowerCase().includes("could not establish connection");
    if (!retriable) throw e;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 180));
    return await run();
  }
}

/**
 * Like sendToTabWithInject but tries an existing content port first (faster for many VLM scroll steps).
 */
export async function sendAuditToTab(tabId: number, tabUrl: string | undefined, message: object): Promise<unknown> {
  if (isHostileExtensionUrl(tabUrl)) {
    throw new Error(
      "This tab can’t be checked—built-in browser pages and the Web Store block extensions. Open a normal website first.",
    );
  }
  try {
    return await sendMessageToTab(tabId, message);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const retriable =
      raw.toLowerCase().includes("receiving end does not exist") ||
      raw.toLowerCase().includes("could not establish connection");
    if (!retriable) throw new Error(friendlyTabError(raw, tabUrl));
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 220));
    return await sendMessageToTab(tabId, message);
  }
}
