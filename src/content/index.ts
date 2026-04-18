import type { AuditIssue, ViewportProfile } from "../types/audit";
import {
  clearAuditOverlay,
  collectDomAuditSnapshot,
  expandPageByScrolling,
  renderAuditOverlay,
  setOverlayVisible,
  type AuditScrollExpandOptions,
} from "./auditDom";
import {
  readScrollMetrics,
  resetFairFrameScrollSession,
  restoreScrollState,
  saveScrollState,
  setPrimaryScroll,
  settleAfterScroll,
  type FairFrameSavedScroll,
} from "./fairframeScroll";

const HOOK = "__ux_audit_content_v1";
const w = window as unknown as Record<string, boolean>;

type CollectMsg = {
  type: "AUDIT_COLLECT";
  viewportProfile: ViewportProfile;
  scrollExpand?: AuditScrollExpandOptions;
};

type PreparePageMsg = {
  type: "AUDIT_PREPARE_PAGE";
  scrollExpand: AuditScrollExpandOptions;
};

type VlmGotoMsg = { type: "AUDIT_VLM_GOTO"; offset: number; settleMs: number };
type VlmRestoreMsg = { type: "AUDIT_VLM_RESTORE"; saved: FairFrameSavedScroll };
type OverlayMsg = {
  type: "AUDIT_RENDER_OVERLAY";
  issues: AuditIssue[];
};
type ToggleMsg = { type: "AUDIT_OVERLAY_TOGGLE"; visible: boolean };
type ClearMsg = { type: "AUDIT_OVERLAY_CLEAR" };

if (!w[HOOK]) {
  w[HOOK] = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "AUDIT_PREPARE_PAGE") {
      const m = msg as PreparePageMsg;
      void (async () => {
        try {
          resetFairFrameScrollSession();
          const se = await expandPageByScrolling(m.scrollExpand);
          sendResponse({
            ok: true,
            scrollExpansion: {
              didRun: true,
              steps: se.steps,
              usedMs: se.scrollUsedMs,
            },
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (msg?.type === "AUDIT_VLM_BEGIN") {
      void (async () => {
        try {
          resetFairFrameScrollSession();
          const saved = saveScrollState();
          const metrics = readScrollMetrics();
          sendResponse({
            ok: true,
            saved,
            metrics: {
              kind: metrics.kind,
              scrollHeight: metrics.scrollHeight,
              viewportH: metrics.viewportH,
              viewportW: metrics.viewportW,
              primary: metrics.primary,
            },
          });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (msg?.type === "AUDIT_VLM_GOTO") {
      const m = msg as VlmGotoMsg;
      void (async () => {
        try {
          setPrimaryScroll(m.offset);
          await settleAfterScroll(m.settleMs);
          sendResponse({ ok: true, primary: readScrollMetrics().primary });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (msg?.type === "AUDIT_VLM_RESTORE") {
      const m = msg as VlmRestoreMsg;
      void (async () => {
        try {
          restoreScrollState(m.saved);
          await settleAfterScroll(100);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (msg?.type === "AUDIT_COLLECT") {
      const m = msg as CollectMsg;
      const profile: ViewportProfile =
        m.viewportProfile === "tablet" || m.viewportProfile === "mobile" ? m.viewportProfile : "desktop";
      void (async () => {
        try {
          const se = m.scrollExpand
            ? await expandPageByScrolling(m.scrollExpand)
            : { scrollExpanded: false, scrollUsedMs: 0, steps: 0 };
          const { nodes, meta } = collectDomAuditSnapshot(profile);
          if (se.scrollExpanded) {
            meta.scrollExpansion = {
              didRun: true,
              steps: se.steps,
              usedMs: se.scrollUsedMs,
            };
          }
          sendResponse({ ok: true, nodes, meta });
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    if (msg?.type === "AUDIT_RENDER_OVERLAY") {
      const m = msg as OverlayMsg;
      try {
        renderAuditOverlay(
          (m.issues || []).map((i) => ({
            id: i.id,
            selector: i.selector,
            severity: i.severity,
            description: i.description,
            impactedUsers: i.impactedUsers,
            suggestedFix: i.suggestedFix,
            boundingBox: i.boundingBox,
          })),
        );
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return true;
    }

    if (msg?.type === "AUDIT_OVERLAY_TOGGLE") {
      const m = msg as ToggleMsg;
      setOverlayVisible(Boolean(m.visible));
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === "AUDIT_OVERLAY_CLEAR") {
      clearAuditOverlay();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
}
