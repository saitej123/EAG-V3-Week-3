import { getTargetTabForCapture } from "./activeTab";
import { listAnalysisHistory, normalizePageKey } from "./analysisHistory";

export type SessionPageHints = {
  tabContextMismatch: boolean;
  activeTabUrl?: string;
  activeTabTitle?: string;
  /** Focused tab URL was found in saved analysis history. */
  activePageInHistory: boolean;
  /** When this URL was last captured (history), ms epoch. */
  activePageLastCapturedAt: number | null;
  /** Session snapshot is for the same page as the focused tab. */
  captureAlignedWithActiveTab: boolean;
};

const emptyHints: SessionPageHints = {
  tabContextMismatch: false,
  activePageInHistory: false,
  activePageLastCapturedAt: null,
  captureAlignedWithActiveTab: false,
};

export async function computeSessionPageHints(snapshotUrl: string | undefined): Promise<SessionPageHints> {
  try {
    const tab = await getTargetTabForCapture();
    const u = (tab.url || tab.pendingUrl || "").trim();
    if (!u) return emptyHints;

    const activeKey = normalizePageKey(u);
    const snapKey = snapshotUrl?.trim() ? normalizePageKey(snapshotUrl) : "";
    const captureAlignedWithActiveTab = !!snapKey && activeKey === snapKey;
    const tabContextMismatch = !!snapKey && activeKey !== snapKey;

    const items = await listAnalysisHistory();
    const hit = items.find((i) => normalizePageKey(i.url) === activeKey);

    return {
      tabContextMismatch,
      activeTabUrl: u,
      activeTabTitle: tab.title || undefined,
      activePageInHistory: !!hit,
      activePageLastCapturedAt: hit?.capturedAt ?? null,
      captureAlignedWithActiveTab,
    };
  } catch {
    return emptyHints;
  }
}
