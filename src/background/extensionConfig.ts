import { DEFAULT_GEMINI_AUDIT_MODEL } from "../config/gemini";

/** Optional JSON beside the extension bundle: `fairframe.config.json` (preferred) or legacy `webmacaw.config.json`. */
export type ExtensionConfigFile = {
  geminiModel?: string;
  /** "chrome" = Chrome OS/browser tts API; "gemini" = Gemini preview TTS model (separate billable call). */
  ttsEngine?: string;
  geminiTtsModel?: string;
  geminiTtsVoice?: string;
  /** Capture visible tab JPEG for VLM (default true). */
  captureViewport?: boolean;
  /** Scroll the page before capture to trigger lazy-loaded DOM (default true). */
  scrollBeforeCapture?: boolean;
  /** Max time (ms) spent scrolling to expand lazy content (default 18000). */
  scrollMaxMs?: number;
  /** Stop after ~N viewport heights of scrolling (default 48; caps endless feeds). */
  scrollMaxViewportHeights?: number;
  /** Max characters of extracted text sent to the model (default 200000). */
  maxTextChars?: number;
  /** Max number of inline images (same-origin JPEG) after scroll (default 12). */
  maxInlineImages?: number;
  /** Max JPEG strips for vision capture (tiled scroll). Default 20, clamped 4–32. */
  maxVlmStrips?: number;
};

export type ResolvedExtensionConfig = {
  geminiModel: string;
  ttsEngine: "chrome" | "gemini";
  geminiTtsModel: string;
  geminiTtsVoice: string;
  captureViewport: boolean;
  scrollBeforeCapture: boolean;
  scrollMaxMs: number;
  scrollMaxViewportHeights: number;
  maxTextChars: number;
  maxInlineImages: number;
  maxVlmStrips: number;
};

const DEFAULTS: ResolvedExtensionConfig = {
  geminiModel: DEFAULT_GEMINI_AUDIT_MODEL,
  ttsEngine: "gemini",
  geminiTtsModel: "gemini-2.5-flash-preview-tts",
  geminiTtsVoice: "Aoede",
  captureViewport: true,
  scrollBeforeCapture: true,
  scrollMaxMs: 14_000,
  scrollMaxViewportHeights: 32,
  maxTextChars: 200_000,
  maxInlineImages: 12,
  maxVlmStrips: 20,
};

let cache: ResolvedExtensionConfig | null = null;

function normalizeEngine(v: string | undefined): "chrome" | "gemini" {
  const x = (v || "chrome").toLowerCase().trim();
  return x === "gemini" ? "gemini" : "chrome";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi);
}

const CONFIG_FILENAMES = ["fairframe.config.json", "webmacaw.config.json"] as const;

async function loadExtensionConfigFile(): Promise<ExtensionConfigFile | null> {
  for (const name of CONFIG_FILENAMES) {
    try {
      const res = await fetch(chrome.runtime.getURL(name));
      if (res.ok) return (await res.json()) as ExtensionConfigFile;
    } catch {
      /* try next */
    }
  }
  return null;
}

function resolveFromFile(j: ExtensionConfigFile): ResolvedExtensionConfig {
  const num = (v: unknown, d: number) =>
    typeof v === "number" && !Number.isNaN(v)
      ? v
      : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))
        ? Number(v)
        : d;

  return {
    geminiModel: j.geminiModel?.trim() || DEFAULTS.geminiModel,
    ttsEngine: normalizeEngine(j.ttsEngine),
    geminiTtsModel: j.geminiTtsModel?.trim() || DEFAULTS.geminiTtsModel,
    geminiTtsVoice: j.geminiTtsVoice?.trim() || DEFAULTS.geminiTtsVoice,
    captureViewport: j.captureViewport !== false,
    scrollBeforeCapture: j.scrollBeforeCapture !== false,
    scrollMaxMs: clamp(num(j.scrollMaxMs, DEFAULTS.scrollMaxMs), 2_000, 120_000),
    scrollMaxViewportHeights: clamp(
      num(j.scrollMaxViewportHeights, DEFAULTS.scrollMaxViewportHeights),
      8,
      400,
    ),
    maxTextChars: clamp(num(j.maxTextChars, DEFAULTS.maxTextChars), 20_000, 900_000),
    maxInlineImages: clamp(num(j.maxInlineImages, DEFAULTS.maxInlineImages), 4, 32),
    maxVlmStrips: clamp(num(j.maxVlmStrips, DEFAULTS.maxVlmStrips), 4, 32),
  };
}

export async function getExtensionConfig(): Promise<ResolvedExtensionConfig> {
  if (cache) return cache;
  const j = await loadExtensionConfigFile();
  cache = j ? resolveFromFile(j) : { ...DEFAULTS };
  return cache;
}

export function clearExtensionConfigCache() {
  cache = null;
}
