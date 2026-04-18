import type { AuditIssue, AuditRunComparison, AuditSummary } from "../types/audit";

const STORAGE_KEY = "fairframeAuditRunsV1";
const MAX_ENTRIES = 24;
const MAX_SNIPPETS = 20;

export type AuditRunHistoryEntry = {
  id: string;
  pageKey: string;
  url: string;
  title: string;
  analyzedAt: number;
  summary: AuditSummary;
  issueFingerprints: string[];
  issueSnippets: { severity: string; type: string; selector: string; description: string }[];
};

export function auditPageKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.origin}${u.pathname}`.replace(/\/$/, "") || u.origin;
  } catch {
    return url.split("#")[0] || url;
  }
}

export function issueFingerprint(issue: AuditIssue): string {
  return `${issue.severity}|${issue.type}|${issue.selector.slice(0, 180)}`;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readAll(): Promise<AuditRunHistoryEntry[]> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const list = raw[STORAGE_KEY];
  return Array.isArray(list) ? (list as AuditRunHistoryEntry[]) : [];
}

/** Most recent stored run for this page (same origin+path), or null. */
export async function getLatestAuditForPage(url: string): Promise<AuditRunHistoryEntry | null> {
  const pk = auditPageKey(url);
  const list = await readAll();
  return list.find((e) => e.pageKey === pk) ?? null;
}

export function buildPriorAuditContext(entry: AuditRunHistoryEntry | null): string | undefined {
  if (!entry) return undefined;
  const lines = entry.issueSnippets.slice(0, 14).map(
    (s) =>
      `- [${s.severity}] ${s.type}: ${s.description.slice(0, 160)} (selector: ${s.selector.slice(0, 100)})`,
  );
  return `Prior FairFrame audit on this page (${new Date(entry.analyzedAt).toISOString()}): ${entry.summary.total} issue(s) (critical ${entry.summary.critical}, major ${entry.summary.major}, minor ${entry.summary.minor}, suggestion ${entry.summary.suggestion}).
The page may have changed. Compare with the current DOM and images. Call out regressions, likely fixed items, and new risks.
Previous summaries (fingerprints may no longer match if markup changed):
${lines.join("\n")}`;
}

export function compareToPrior(
  prior: AuditRunHistoryEntry | null,
  issues: AuditIssue[],
): AuditRunComparison | undefined {
  if (!prior) return undefined;
  const prevSet = new Set(prior.issueFingerprints);
  const currFp = issues.map(issueFingerprint);
  const currSet = new Set(currFp);
  let likelyNew = 0;
  for (const f of currSet) if (!prevSet.has(f)) likelyNew++;
  let likelyResolved = 0;
  for (const f of prevSet) if (!currSet.has(f)) likelyResolved++;
  let likelyUnchanged = 0;
  for (const f of currSet) if (prevSet.has(f)) likelyUnchanged++;
  return {
    previousAnalyzedAt: prior.analyzedAt,
    previousTotal: prior.summary.total,
    likelyNew,
    likelyResolved,
    likelyUnchanged,
  };
}

/** Append a lite run to local storage (newest first). */
export async function appendAuditRunHistory(params: {
  url: string;
  title: string;
  analyzedAt: number;
  summary: AuditSummary;
  issues: AuditIssue[];
}): Promise<void> {
  const pageKey = auditPageKey(params.url);
  const issueSnippets = params.issues.slice(0, MAX_SNIPPETS).map((i) => ({
    severity: i.severity,
    type: i.type,
    selector: i.selector.slice(0, 200),
    description: i.description.slice(0, 400),
  }));
  const row: AuditRunHistoryEntry = {
    id: randomId(),
    pageKey,
    url: params.url.slice(0, 2000),
    title: params.title.slice(0, 500),
    analyzedAt: params.analyzedAt,
    summary: params.summary,
    issueFingerprints: params.issues.map(issueFingerprint),
    issueSnippets,
  };

  let next = [row, ...(await readAll())].slice(0, MAX_ENTRIES);
  while (next.length > 0) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: next });
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
}
