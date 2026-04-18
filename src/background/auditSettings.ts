import type { ViewportProfile } from "../types/audit";
import { DEFAULT_GEMINI_AUDIT_MODEL, DEFAULT_GEMINI_IMAGE_MODEL } from "../config/gemini";
import { getBundledGeminiApiKey } from "./bundledLocalConfig";

const K_BASE = "auditApiBaseUrl";
const K_KEY = "auditApiKey";
const K_VIEWPORT = "auditDefaultViewport";
/** Same key as Google AI Studio / legacy sync-env — used for Gemini reviews. */
const K_GEMINI_KEY = "geminiApiKey";
const K_GEMINI_MODEL = "auditGeminiModel";
const K_GEMINI_IMAGE_MODEL = "auditGeminiImageModel";
const K_GEMINI_MOCKUPS = "auditGeminiMockupsEnabled";

export const DEFAULT_AUDIT_API_BASE = "https://api.my-gemini-audit.com";

export { DEFAULT_GEMINI_AUDIT_MODEL, DEFAULT_GEMINI_IMAGE_MODEL };

export type AuditSettings = {
  apiBaseUrl: string;
  apiKey: string;
  defaultViewport: ViewportProfile;
  geminiApiKey: string;
  geminiModel: string;
  geminiImageModel: string;
  /** When true, run image model for planned mockups (extra API calls). */
  geminiMockupsEnabled: boolean;
};

function normalizeBase(url: string): string {
  const t = url.trim().replace(/\/+$/, "");
  return t || DEFAULT_AUDIT_API_BASE;
}

export function isDemoApiBase(url: string): boolean {
  const u = normalizeBase(url).toLowerCase();
  return u === DEFAULT_AUDIT_API_BASE.toLowerCase() || u.includes("api.my-gemini-audit.com");
}

export async function getAuditSettings(): Promise<AuditSettings> {
  const local = await chrome.storage.local.get([
    K_BASE,
    K_KEY,
    K_VIEWPORT,
    K_GEMINI_KEY,
    K_GEMINI_MODEL,
    K_GEMINI_IMAGE_MODEL,
    K_GEMINI_MOCKUPS,
  ]);
  const base = normalizeBase(String(local[K_BASE] || DEFAULT_AUDIT_API_BASE));
  const key = String(local[K_KEY] || "").trim();
  const vp = local[K_VIEWPORT] as ViewportProfile | undefined;
  const defaultViewport: ViewportProfile =
    vp === "tablet" || vp === "mobile" || vp === "desktop" ? vp : "desktop";
  const storedGemini = local[K_GEMINI_KEY];
  /** Storage wins; if the user never saved a key, fall back to bundled `config.local.json` from `.env` at build time. */
  const geminiApiKey =
    storedGemini === undefined
      ? (await getBundledGeminiApiKey()).trim()
      : String(storedGemini).trim();
  const geminiModelRaw = String(local[K_GEMINI_MODEL] || "").trim();
  const geminiModel = geminiModelRaw || DEFAULT_GEMINI_AUDIT_MODEL;
  const geminiImageModelRaw = String(local[K_GEMINI_IMAGE_MODEL] || "").trim();
  const geminiImageModel = geminiImageModelRaw || DEFAULT_GEMINI_IMAGE_MODEL;
  const geminiMockupsEnabled = local[K_GEMINI_MOCKUPS] === false ? false : true;
  return {
    apiBaseUrl: base,
    apiKey: key,
    defaultViewport,
    geminiApiKey,
    geminiModel,
    geminiImageModel,
    geminiMockupsEnabled,
  };
}

export async function saveAuditSettings(partial: Partial<AuditSettings>): Promise<void> {
  const patch: Record<string, string | boolean> = {};
  if (partial.apiBaseUrl != null) patch[K_BASE] = normalizeBase(partial.apiBaseUrl);
  if (partial.apiKey != null) patch[K_KEY] = partial.apiKey.trim();
  if (partial.defaultViewport != null) patch[K_VIEWPORT] = partial.defaultViewport;
  if (partial.geminiApiKey != null) patch[K_GEMINI_KEY] = partial.geminiApiKey.trim();
  if (partial.geminiModel != null) patch[K_GEMINI_MODEL] = partial.geminiModel.trim() || DEFAULT_GEMINI_AUDIT_MODEL;
  if (partial.geminiImageModel != null)
    patch[K_GEMINI_IMAGE_MODEL] = partial.geminiImageModel.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
  if (partial.geminiMockupsEnabled != null) patch[K_GEMINI_MOCKUPS] = partial.geminiMockupsEnabled;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}
