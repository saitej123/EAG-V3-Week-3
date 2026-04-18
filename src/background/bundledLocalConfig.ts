/**
 * Dev/local: `npm run build` runs sync-env → `public/config.local.json` from `.env` (GEMINI_API_KEY).
 * Copied into the extension bundle; not committed (gitignored). Background reads it when storage has no key.
 */
let cached: string | undefined;

export function clearBundledGeminiKeyCache(): void {
  cached = undefined;
}

export async function getBundledGeminiApiKey(): Promise<string> {
  if (cached !== undefined) return cached;
  try {
    const url = chrome.runtime.getURL("config.local.json");
    const res = await fetch(url);
    if (!res.ok) {
      cached = "";
      return "";
    }
    const j = (await res.json()) as { geminiApiKey?: unknown };
    const k = typeof j.geminiApiKey === "string" ? j.geminiApiKey.trim() : "";
    cached = k;
    return k;
  } catch {
    cached = "";
    return "";
  }
}
