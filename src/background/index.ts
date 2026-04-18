import type {
  AuditAnalysisMeta,
  AuditRequestPayload,
  AuditSessionStored,
  ViewportProfile,
} from "../types/audit";
import { postAuditAnalyze } from "./auditApi";
import { getAuditSettings, isDemoApiBase, saveAuditSettings } from "./auditSettings";
import { validateGeminiApiKey } from "./validateKey";
import { sendAuditToTab, sendToTabWithInject } from "./auditTab";
import { getTargetTabForCapture } from "./activeTab";
import { isHostileExtensionUrl } from "./tabCapture";
import {
  appendAuditRunHistory,
  buildPriorAuditContext,
  compareToPrior,
  getLatestAuditForPage,
} from "./auditRunHistory";
import { captureFullPageJpegStrips } from "./fullPageCapture";
import { getExtensionConfig } from "./extensionConfig";
import { captureViewportJpegBase64 } from "./viewportCapture";

const SESSION_LAST = "auditLastSession";
const SESSION_OVERLAY_ON = "auditOverlayVisible";

function stripMockupBinary(s: AuditSessionStored): AuditSessionStored {
  return {
    ...s,
    response: {
      ...s.response,
      issues: s.response.issues.map((i) => {
        const copy = { ...i };
        delete copy.mockupImageBase64;
        delete copy.mockupImageMime;
        return copy;
      }),
    },
  };
}

function stripViewportPreview(s: AuditSessionStored): AuditSessionStored {
  return { ...s, viewportPreviewJpegBase64: undefined };
}

async function persistAuditSession(stored: AuditSessionStored): Promise<void> {
  const write = (data: AuditSessionStored) =>
    new Promise<void>((resolve, reject) => {
      chrome.storage.session.set({ [SESSION_LAST]: data, [SESSION_OVERLAY_ON]: true }, () => {
        const e = chrome.runtime.lastError;
        if (e) reject(new Error(e.message));
        else resolve();
      });
    });
  const noMock = stripMockupBinary(stored);
  const noView = stripViewportPreview(stored);
  const minimal = stripViewportPreview(noMock);
  try {
    await write(stored);
  } catch {
    try {
      await write(noMock);
    } catch {
      try {
        await write(noView);
      } catch {
        try {
          await write(minimal);
        } catch {
          /* ignore — quota or other storage failure */
        }
      }
    }
  }
}

function logStamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function enableSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    /* ignore */
  });
}

chrome.runtime.onInstalled.addListener(enableSidePanel);
enableSidePanel();

chrome.commands.onCommand.addListener((command) => {
  if (command === "run-fairframe-review") {
    void runAuditFlow(undefined, true);
  }
});

async function runAuditFlow(
  viewportProfile?: ViewportProfile,
  fromCommand?: boolean,
): Promise<AuditSessionStored> {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(`${logStamp()} ${msg}`);
  };

  log("Starting FairFrame audit pipeline…");
  const tab = await getTargetTabForCapture();
  const tabId = tab.id!;
  const tabUrl = tab.url ?? tab.pendingUrl;

  if (isHostileExtensionUrl(tabUrl)) {
    throw new Error(
      "This tab can’t be checked—built-in browser pages and the Web Store block extensions. Open a normal website first.",
    );
  }

  log(`Tab: ${(tab.title || "").slice(0, 120)}`);
  log(`URL: ${(tabUrl || "").slice(0, 240)}`);

  const settings = await getAuditSettings();
  if (isDemoApiBase(settings.apiBaseUrl) && !settings.geminiApiKey?.trim()) {
    throw new Error("Add a Gemini API key in FairFrame Settings or the panel.");
  }

  const engine: AuditAnalysisMeta["engine"] = !isDemoApiBase(settings.apiBaseUrl) ? "custom_http" : "gemini";
  if (engine === "gemini") {
    log(
      `Engine: gemini · text ${settings.geminiModel}${
        settings.geminiMockupsEnabled ? ` · image mockups ${settings.geminiImageModel}` : " · mockups disabled"
      }`,
    );
  } else {
    log("Engine: custom_http (your review URL)");
  }

  /** Matches side panel: always label as desktop unless a future caller passes another profile. */
  const profile: ViewportProfile = viewportProfile ?? "desktop";
  log(`Viewport label: ${profile}`);

  const extCfg = await getExtensionConfig();
  log(
    `Extension capture: max ${extCfg.maxVlmStrips} VLM strip(s), scroll-before-DOM ${extCfg.scrollBeforeCapture ? "on" : "off"} (≤${extCfg.scrollMaxViewportHeights} vh / ${extCfg.scrollMaxMs}ms).`,
  );

  let preExpandMeta: { didRun: boolean; steps: number; usedMs: number } | undefined;
  if (extCfg.scrollBeforeCapture) {
    log("Pre-expand (async): scroll to hydrate lazy content before VLM screenshots…");
    try {
      const pr = (await sendAuditToTab(tabId, tabUrl, {
        type: "AUDIT_PREPARE_PAGE",
        scrollExpand: {
          scrollBeforeCapture: true,
          scrollMaxMs: extCfg.scrollMaxMs,
          scrollMaxViewportHeights: extCfg.scrollMaxViewportHeights,
        },
      })) as {
        ok?: boolean;
        scrollExpansion?: { didRun: boolean; steps: number; usedMs: number };
        error?: string;
      };
      if (pr?.ok && pr.scrollExpansion) {
        preExpandMeta = pr.scrollExpansion;
        log(`Pre-expand done: ${pr.scrollExpansion.steps} step(s), ${pr.scrollExpansion.usedMs}ms.`);
      } else if (!pr?.ok) {
        log(`WARN: pre-expand skipped — ${pr?.error || "unknown"}`);
      }
    } catch (e) {
      log(`WARN: pre-expand failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const windowId = tab.windowId;
  let strips: string[] = [];
  if (extCfg.captureViewport) {
    if (windowId != null) {
      log("VLM: async tiled strips (content script scroll + settle), then restore…");
      strips = await captureFullPageJpegStrips(windowId, tabId, tabUrl, 68, {
        maxStrips: extCfg.maxVlmStrips,
        settleMs: 450,
      });
    } else {
      const one = await captureViewportJpegBase64(68);
      if (one) strips = [one];
    }
  } else {
    log("VLM capture disabled (fairframe.config.json captureViewport: false).");
  }
  if (strips.length) {
    const totalKb = strips.reduce((acc, s) => acc + Math.round((s.length * 3) / 4 / 1024), 0);
    log(`VLM: ${strips.length} JPEG strip(s), ~${totalKb} KB base64 total.`);
  } else {
    log("WARN: no JPEG strips — model runs DOM-only.");
  }

  log("Collect DOM snapshot…");
  const collectRes = (await sendToTabWithInject(tabId, tabUrl, {
    type: "AUDIT_COLLECT",
    viewportProfile: profile,
    scrollExpand: {
      scrollBeforeCapture: extCfg.scrollBeforeCapture && !preExpandMeta,
      scrollMaxMs: extCfg.scrollMaxMs,
      scrollMaxViewportHeights: extCfg.scrollMaxViewportHeights,
    },
  })) as {
    ok?: boolean;
    nodes?: AuditRequestPayload["dom"]["nodes"];
    meta?: AuditRequestPayload["meta"];
    error?: string;
  };

  if (!collectRes?.ok || !collectRes.nodes || !collectRes.meta) {
    throw new Error(collectRes?.error || "Could not read this page—try refreshing the tab.");
  }

  if (preExpandMeta) {
    collectRes.meta.scrollExpansion = preExpandMeta;
  }

  const docH = collectRes.meta.document?.scrollHeight ?? "?";
  const se = collectRes.meta.scrollExpansion;
  log(
    `DOM nodes: ${collectRes.nodes.length} (${docH}px doc height)${se?.didRun ? ` · scroll-expand ${se.steps} step(s), ${se.usedMs}ms` : ""}.`,
  );

  const jpeg = strips[0] ?? null;
  const scrollExtras = strips.length > 1 ? strips.slice(1) : undefined;

  const payload: AuditRequestPayload = {
    meta: collectRes.meta,
    screenshotViewportJpegBase64: jpeg,
    screenshotScrollStripsJpegBase64: scrollExtras,
    dom: { nodes: collectRes.nodes },
  };

  const prior = await getLatestAuditForPage(collectRes.meta.url);
  const priorAuditContext = buildPriorAuditContext(prior);
  if (priorAuditContext) {
    payload.priorAuditContext = priorAuditContext;
    log("Loaded prior local run for this URL → feeding model for regression-aware analysis.");
  }

  log("POST audit analysis…");
  const onAgentLog = (msg: string) => {
    chrome.runtime.sendMessage({ type: "AGENT_LOG_UPDATE", message: msg }).catch(() => {});
    log(`[Agent] ${msg}`);
  };
  const response = await postAuditAnalyze(payload, tabId, onAgentLog);
  log(`Analysis returned ${response.issues.length} issue(s); summary.total=${response.summary.total}.`);
  if (response.notes?.trim()) {
    const n = response.notes.trim();
    log(`Model notes: ${n.slice(0, 240)}${n.length > 240 ? "…" : ""}`);
  }

  log("Push heatmap overlay to tab…");
  await sendToTabWithInject(tabId, tabUrl, {
    type: "AUDIT_RENDER_OVERLAY",
    issues: response.issues,
  }).catch(() => {
    log("WARN: overlay inject failed (navigation or restricted page).");
  });

  log("Persist session (may strip mockups / screenshot if storage quota is exceeded)…");
  log("Finished.");
  const analyzedAt = Date.now();
  const comparison = compareToPrior(prior, response.issues);
  const stored: AuditSessionStored = {
    meta: payload.meta,
    response,
    analyzedAt,
    domNodeCount: payload.dom.nodes.length,
    viewportPreviewJpegBase64: jpeg,
    analysisLog: [...logs],
    analysisMeta: {
      engine,
      textModel: engine === "gemini" ? settings.geminiModel : undefined,
      imageModel: engine === "gemini" && settings.geminiMockupsEnabled ? settings.geminiImageModel : undefined,
      hadViewportScreenshot: strips.length > 0,
      screenshotStripCount: strips.length,
      domNodesSent: payload.dom.nodes.length,
      tabTitle: tab.title || undefined,
      tabUrl: tabUrl || undefined,
    },
    comparison,
  };

  await persistAuditSession(stored);

  try {
    await appendAuditRunHistory({
      url: collectRes.meta.url,
      title: collectRes.meta.title,
      analyzedAt,
      summary: response.summary,
      issues: response.issues,
    });
    log("Saved lite run to chrome.storage.local for next comparison.");
  } catch {
    log("WARN: could not append local audit history (quota?).");
  }

  if (fromCommand && tab.windowId != null) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch {
      /* ignore */
    }
  }

  return stored;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "AUDIT_GET_SETTINGS") {
      const settings = await getAuditSettings();
      const reviewSource: "gemini" | "custom" | "demo" = !isDemoApiBase(settings.apiBaseUrl)
        ? "custom"
        : settings.geminiApiKey
          ? "gemini"
          : "demo";
      sendResponse({ ok: true, settings, reviewSource });
      return;
    }

    if (message?.type === "AUDIT_VALIDATE_GEMINI_KEY") {
      const key = String(message.key || "").trim();
      const result = await validateGeminiApiKey(key);
      if (result.ok) sendResponse({ ok: true });
      else sendResponse({ ok: false, error: result.message });
      return;
    }

    if (message?.type === "AUDIT_SET_GEMINI_KEY") {
      const key = String(message.key || "").trim();
      await saveAuditSettings({ geminiApiKey: key });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "AUDIT_RUN") {
      try {
        const vp = message.viewportProfile as ViewportProfile | undefined;
        const session = await runAuditFlow(vp, false);
        sendResponse({ ok: true, session });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    if (message?.type === "AUDIT_LOAD_LAST") {
      const s = await chrome.storage.session.get([SESSION_LAST, SESSION_OVERLAY_ON]);
      sendResponse({
        ok: true,
        session: s[SESSION_LAST] as AuditSessionStored | undefined,
        overlayVisible: Boolean(s[SESSION_OVERLAY_ON]),
      });
      return;
    }

    if (message?.type === "AUDIT_TOGGLE_OVERLAY") {
      const tab = await getTargetTabForCapture().catch(() => null);
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No tab." });
        return;
      }
      const s = await chrome.storage.session.get(SESSION_OVERLAY_ON);
      const next = typeof message.visible === "boolean" ? message.visible : !Boolean(s[SESSION_OVERLAY_ON]);
      await chrome.storage.session.set({ [SESSION_OVERLAY_ON]: next });
      const tabUrl = tab.url ?? tab.pendingUrl;
      await sendToTabWithInject(tab.id, tabUrl, { type: "AUDIT_OVERLAY_TOGGLE", visible: next }).catch(() => {});
      sendResponse({ ok: true, visible: next });
      return;
    }

    if (message?.type === "AUDIT_CLEAR_OVERLAY") {
      const tab = await getTargetTabForCapture().catch(() => null);
      if (tab?.id) {
        const tabUrl = tab.url ?? tab.pendingUrl;
        await sendToTabWithInject(tab.id, tabUrl, { type: "AUDIT_OVERLAY_CLEAR" }).catch(() => {});
      }
      await chrome.storage.session.set({ [SESSION_OVERLAY_ON]: false });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message." });
  })().catch((e) => {
    sendResponse({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  });

  return true;
});
