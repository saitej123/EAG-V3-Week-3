import type { ChatMessage, PageSnapshot } from "../types/messages";

const STORAGE_KEY = "analysisHistoryV1";
const MAX_ENTRIES = 14;
/** Keep stored text bounded so local storage stays under quota. */
const MAX_STORED_TEXT = 120_000;

export type AnalysisHistoryEntry = {
  id: string;
  url: string;
  title: string;
  capturedAt: number;
  snapshot: PageSnapshot;
  history: ChatMessage[];
};

export type AnalysisHistoryListItem = {
  id: string;
  url: string;
  title: string;
  capturedAt: number;
  textChars: number;
  chatTurns: number;
};

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function stripSnapshotForHistory(s: PageSnapshot): PageSnapshot {
  const text =
    s.text.length > MAX_STORED_TEXT ? s.text.slice(0, MAX_STORED_TEXT) : s.text;
  return {
    ...s,
    text,
    textTruncated: s.textTruncated || s.text.length > MAX_STORED_TEXT,
    viewportScreenshotJpeg: null,
    images: s.images.map((im) => ({
      alt: im.alt,
      src: im.src,
      base64Jpeg: null,
    })),
  };
}

export function normalizePageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.origin}${u.pathname}`.replace(/\/$/, "") || u.origin;
  } catch {
    return url.split("#")[0] || url;
  }
}

async function readAll(): Promise<AnalysisHistoryEntry[]> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const list = raw[STORAGE_KEY];
  return Array.isArray(list) ? (list as AnalysisHistoryEntry[]) : [];
}

async function writeAll(entries: AnalysisHistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

export async function listAnalysisHistory(): Promise<AnalysisHistoryListItem[]> {
  const all = await readAll();
  return all.map((e) => ({
    id: e.id,
    url: e.url,
    title: e.title,
    capturedAt: e.capturedAt,
    textChars: e.snapshot.text.length,
    chatTurns: e.history.length,
  }));
}

export async function getAnalysisHistoryEntry(id: string): Promise<AnalysisHistoryEntry | null> {
  const all = await readAll();
  return all.find((e) => e.id === id) ?? null;
}

export async function removeAnalysisHistoryEntry(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((e) => e.id !== id));
}

/**
 * Saves the latest capture + chat for revisiting. Drops bulky JPEG/base64; caps list size.
 */
export async function recordAnalysisSnapshot(
  snapshot: PageSnapshot,
  history: ChatMessage[],
): Promise<void> {
  const entry: AnalysisHistoryEntry = {
    id: randomId(),
    url: snapshot.url,
    title: snapshot.title,
    capturedAt: snapshot.capturedAt,
    snapshot: stripSnapshotForHistory(snapshot),
    history: [...history],
  };

  const prev = await readAll();
  const key = normalizePageKey(snapshot.url);
  const withoutDup = prev.filter((e) => normalizePageKey(e.url) !== key);
  let next = [entry, ...withoutDup].slice(0, MAX_ENTRIES);

  while (next.length > 0) {
    try {
      await writeAll(next);
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
}
