import { useCallback, useEffect, useState, useRef, type ReactNode } from "react";
import {
  BrainCircuit,
  Download,
  Eye,
  EyeOff,
  GitCompare,
  LayoutList,
  Loader2,
  MonitorSmartphone,
  ScanLine,
  ScrollText,
  Settings,
  SquareStack,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import type { AuditSessionStored } from "../types/audit";
import { auditToJson, auditToMarkdown } from "../lib/auditExport";
import { cn } from "../lib/utils";
import { sendMessage } from "./messaging";
import { AuditFindingsTable } from "./AuditFindingsTable";
import { GeminiSetupGate } from "./GeminiSetupGate";

const AUDIT_VIEWPORT = "desktop" as const;

const PIPELINE_STEPS = [
  "Looking at your tab",
  "Capturing the page",
  "Reading structure",
  "Review with AI",
  "Drawing highlights",
] as const;

type PanelTab = "overview" | "issues" | "agent" | "page" | "log";

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function severityClass(s: string): string {
  switch (s) {
    case "critical":
      return "border-red-600/80 text-red-700 dark:border-red-500/60 dark:text-red-300";
    case "major":
      return "border-orange-600/80 text-orange-800 dark:border-orange-500/50 dark:text-orange-200";
    case "minor":
      return "border-amber-600/70 text-amber-900 dark:border-amber-500/45 dark:text-amber-200";
    default:
      return "border-blue-600/70 text-blue-900 dark:border-blue-500/45 dark:text-blue-200";
  }
}

export default function App() {
  const [session, setSession] = useState<AuditSessionStored | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewSource, setReviewSource] = useState<"gemini" | "custom" | "demo" | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [agentLogs, setAgentLogs] = useState<{ time: string; msg: string }[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (req: any) => {
      if (req.type === "AGENT_LOG_UPDATE") {
        setAgentLogs((prev) => [
          ...prev,
          { time: new Date().toLocaleTimeString(), msg: req.message },
        ]);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  const refresh = useCallback(async () => {
    const res = await sendMessage<{
      ok?: boolean;
      session?: AuditSessionStored;
      overlayVisible?: boolean;
    }>({ type: "AUDIT_LOAD_LAST" });
    if (res.session) setSession(res.session);
    if (typeof res.overlayVisible === "boolean") setOverlayVisible(res.overlayVisible);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadPanelSettings = useCallback(() => {
    void sendMessage<{
      ok?: boolean;
      settings?: { geminiApiKey?: string };
      reviewSource?: "gemini" | "custom" | "demo";
    }>({
      type: "AUDIT_GET_SETTINGS",
    }).then((r) => {
      if (r.reviewSource) setReviewSource(r.reviewSource);
      setHasGeminiKey(Boolean(r.settings?.geminiApiKey?.trim()));
    });
  }, []);

  useEffect(() => {
    loadPanelSettings();
  }, [loadPanelSettings]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") loadPanelSettings();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadPanelSettings]);

  useEffect(() => {
    if (!busy) return;
    setStepIdx(0);
    const id = window.setInterval(() => {
      setStepIdx((i) => (i + 1) % PIPELINE_STEPS.length);
    }, 1100);
    return () => window.clearInterval(id);
  }, [busy]);

  const runAudit = async () => {
    setBusy(true);
    setError(null);
    setAgentLogs([]);
    try {
      const res = await sendMessage<{ ok: boolean; session?: AuditSessionStored; error?: string }>({
        type: "AUDIT_RUN",
        viewportProfile: AUDIT_VIEWPORT,
      });
      if (!res.ok) throw new Error(res.error || "Something went wrong—try again or refresh the page.");
      if (res.session) setSession(res.session);
      setOverlayVisible(true);
      setTab("issues");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleOverlay = async () => {
    setError(null);
    try {
      const res = await sendMessage<{ ok: boolean; visible?: boolean; error?: string }>({
        type: "AUDIT_TOGGLE_OVERLAY",
      });
      if (!res.ok) throw new Error(res.error || "Could not show or hide highlights.");
      if (typeof res.visible === "boolean") setOverlayVisible(res.visible);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openOptions = () => {
    void chrome.runtime.openOptionsPage();
  };

  const onGeminiSaved = () => {
    loadPanelSettings();
  };

  const needsGeminiGate = reviewSource === "demo" && !hasGeminiKey;

  const summary = session?.response.summary;
  const issueCount = session?.response.issues.length ?? 0;

  const reviewHint =
    reviewSource === "custom"
      ? "Using your own review server"
      : reviewSource === "gemini"
        ? "Using Google Gemini"
        : reviewSource === "demo"
          ? "Add an API key to get started"
          : null;

  const meta = session?.meta;
  const am = session?.analysisMeta;

  const tabBtn = (id: PanelTab, label: string, icon: ReactNode, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setTab(id)}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-[11px] font-medium transition-colors",
        tab === id
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="shrink-0 border-b border-zinc-200/80 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Agentic FairFrame</h1>
            {reviewHint ? <p className="mt-0.5 text-[10px] text-zinc-500">{reviewHint}</p> : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 px-2.5"
            onClick={openOptions}
            aria-label="Open Agentic FairFrame settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        {!needsGeminiGate ? (
          <div className="flex border-t border-zinc-100 dark:border-zinc-800">
            {tabBtn("overview", "Home", <SquareStack className="h-3.5 w-3.5" />)}
            {tabBtn(
              "issues",
              `Findings${session ? ` (${issueCount})` : ""}`,
              <LayoutList className="h-3.5 w-3.5" />,
              !session,
            )}
            {tabBtn(
              "agent",
              "Agent",
              <BrainCircuit className="h-3.5 w-3.5" />,
              agentLogs.length === 0,
            )}
            {tabBtn("page", "This page", <MonitorSmartphone className="h-3.5 w-3.5" />, !session)}
            {tabBtn(
              "log",
              "Activity",
              <ScrollText className="h-3.5 w-3.5" />,
              !session?.analysisLog?.length,
            )}
          </div>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="mx-3 mt-3 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </div>
        ) : null}

        {needsGeminiGate ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <GeminiSetupGate onSaved={onGeminiSaved} />
            <p className="text-center text-[11px] text-zinc-500">
              Prefer your own backend?{" "}
              <button type="button" className="font-medium text-zinc-700 underline dark:text-zinc-300" onClick={openOptions}>
                Open settings
              </button>
            </p>
          </div>
        ) : null}

        {!needsGeminiGate && tab === "overview" ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pb-6">
            {busy ? (
              <div className="p-4 space-y-4 rounded-xl border border-blue-200/80 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                      <span className="animate-spin text-xl">⏳</span>
                      <span className="font-semibold text-sm">Agentic FairFrame is analyzing...</span>
                  </div>
                  
                  <div className="bg-gray-900 text-green-400 p-3 rounded-md text-xs font-mono h-48 overflow-y-auto space-y-2 shadow-inner">
                      {agentLogs.length === 0 ? "Waiting for Gemini..." : ""}
                      {agentLogs.map((entry, i) => (
                          <div key={i}>
                              <span className="text-gray-500 mr-2">[{entry.time}]</span>
                              {entry.msg.includes("🛠️") ? <span className="text-yellow-400">{entry.msg}</span> : 
                               entry.msg.includes("📥") ? <span className="text-blue-300">{entry.msg}</span> : 
                               entry.msg.includes("⚠️") ? <span className="text-orange-400">{entry.msg}</span> :
                               entry.msg.includes("✅") ? <span className="text-emerald-400">{entry.msg}</span> :
                               entry.msg}
                          </div>
                      ))}
                      <div ref={logsEndRef} />
                  </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200/90 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/80">
              <Button type="button" className="h-11 w-full text-sm font-medium" disabled={busy} onClick={() => void runAudit()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                Review this page
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" disabled={!session} onClick={() => setTab("issues")}>
                  <LayoutList className="h-4 w-4" />
                  See findings
                </Button>
                <Button type="button" variant="outline" disabled={!session} onClick={() => void toggleOverlay()}>
                  {overlayVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {overlayVisible ? "Hide highlights" : "Show highlights"}
                </Button>
              </div>
            </div>

            {summary ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Latest review</div>
                    <p className="truncate text-xs text-zinc-500" title={session?.meta.url}>
                      {session?.meta.title || session?.meta.url}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2 pt-0">
                    <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium dark:border-zinc-800 dark:bg-zinc-900">
                      {summary.total} finding{summary.total === 1 ? "" : "s"}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium dark:bg-zinc-900",
                        severityClass("critical"),
                      )}
                    >
                      Urgent {summary.critical}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium dark:bg-zinc-900",
                        severityClass("major"),
                      )}
                    >
                      Important {summary.major}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium dark:bg-zinc-900",
                        severityClass("minor"),
                      )}
                    >
                      Small {summary.minor}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium dark:bg-zinc-900",
                        severityClass("suggestion"),
                      )}
                    >
                      Ideas {summary.suggestion}
                    </span>
                  </CardContent>
                </Card>

                {session?.comparison ? (
                  <Card className="border-emerald-200/90 dark:border-emerald-900/35">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        <GitCompare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Compared to last time
                      </div>
                      <p className="text-[10px] text-zinc-500">
                        Previous review: {new Date(session.comparison.previousAnalyzedAt).toLocaleString()} ·{" "}
                        {session.comparison.previousTotal} finding
                        {session.comparison.previousTotal === 1 ? "" : "s"}
                      </p>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-2 pt-0">
                      <div className="rounded-lg bg-emerald-50 py-2 text-center dark:bg-emerald-950/40">
                        <div className="text-base font-semibold tabular-nums text-emerald-800 dark:text-emerald-200">
                          {session.comparison.likelyResolved}
                        </div>
                        <div className="text-[9px] text-zinc-600 dark:text-zinc-400">Probably resolved</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 py-2 text-center dark:bg-amber-950/40">
                        <div className="text-base font-semibold tabular-nums text-amber-900 dark:text-amber-200">
                          {session.comparison.likelyNew}
                        </div>
                        <div className="text-[9px] text-zinc-600 dark:text-zinc-400">New this run</div>
                      </div>
                      <div className="rounded-lg bg-zinc-100 py-2 text-center dark:bg-zinc-900">
                        <div className="text-base font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                          {session.comparison.likelyUnchanged}
                        </div>
                        <div className="text-[9px] text-zinc-600 dark:text-zinc-400">Still there</div>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-200 bg-white/50 px-4 py-5 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
                Run a review on the tab you have open. We will look at layout, usability, accessibility, and more.
              </p>
            )}
          </div>
        ) : null}

        {!needsGeminiGate && tab === "issues" && session ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <div className="shrink-0 space-y-1">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Export your report</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => downloadText("fairframe-report.md", auditToMarkdown(session), "text/markdown")}
                >
                  <Download className="h-3.5 w-3.5" />
                  Markdown
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => downloadText("fairframe-report.json", auditToJson(session), "application/json")}
                >
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </Button>
              </div>
            </div>
            {session.response.notes ? (
              <p className="shrink-0 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-[12px] leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
                <span className="font-semibold text-amber-900 dark:text-amber-200">Note from the review · </span>
                {session.response.notes}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
              <AuditFindingsTable issues={session.response.issues} />
            </div>
          </div>
        ) : null}

        {!needsGeminiGate && tab === "issues" && !session ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500">
            Start from <span className="font-medium text-zinc-700 dark:text-zinc-300">Home</span> and run a review first.
          </div>
        ) : null}

        {!needsGeminiGate && tab === "agent" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div className="shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                <BrainCircuit className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                Agent Reasoning Chain
              </div>
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Every tool call, result, and decision the AI made — in order.
              </p>
            </div>

            {agentLogs.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500">
                Run a review from <span className="font-medium text-zinc-700 dark:text-zinc-300">Home</span> to see the agent&apos;s reasoning.
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                  {agentLogs.map((entry, i) => {
                    const m = entry.msg;
                    const isToolCall = m.includes("🛠️");
                    const isResult = m.includes("📥");
                    const isThinking = m.includes("💭");
                    const isComplete = m.includes("✅");
                    const isWarning = m.includes("⚠️");
                    const isInit = m.includes("🤖");

                    let textColor = "text-zinc-400";
                    let bg = "";
                    if (isToolCall) { textColor = "text-yellow-300"; bg = "bg-yellow-950/30"; }
                    else if (isResult) { textColor = "text-sky-300"; bg = "bg-sky-950/20"; }
                    else if (isThinking) { textColor = "text-violet-300"; }
                    else if (isComplete) { textColor = "text-emerald-300"; bg = "bg-emerald-950/30"; }
                    else if (isWarning) { textColor = "text-orange-300"; bg = "bg-orange-950/30"; }
                    else if (isInit) { textColor = "text-zinc-300"; }

                    return (
                      <div key={i} className={cn("flex gap-2 rounded px-2 py-1", bg)}>
                        <span className="shrink-0 tabular-nums text-zinc-600">{entry.time}</span>
                        <span className={textColor}>{m}</span>
                      </div>
                    );
                  })}
                  {busy ? (
                    <div className="flex items-center gap-2 px-2 py-1 text-violet-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Agent is working...</span>
                    </div>
                  ) : null}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {!needsGeminiGate && tab === "page" && session && meta ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-6">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  <MonitorSmartphone className="h-4 w-4" />
                  About this page
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0 sm:grid-cols-[minmax(0,1fr)_140px]">
                <dl className="space-y-3 text-[12px]">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Page title
                    </dt>
                    <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{meta.title || "Untitled"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Link
                    </dt>
                    <dd className="mt-0.5 break-all text-zinc-600 dark:text-zinc-400">{meta.url}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Screen size used
                    </dt>
                    <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">
                      {meta.viewport.width} × {meta.viewport.height} pixels
                      <span className="text-zinc-500"> · </span>
                      <span className="capitalize">{meta.viewportProfile}</span> layout
                    </dd>
                  </div>
                  {am ? (
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        How this review was run
                      </dt>
                      <dd className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                        {am.engine === "gemini" ? "Google Gemini" : "Your review server"}
                        {am.screenshotStripCount != null && am.screenshotStripCount > 0
                          ? ` · ${am.screenshotStripCount} page snapshot${am.screenshotStripCount === 1 ? "" : "s"}`
                          : am.hadViewportScreenshot
                            ? " · 1 page snapshot"
                            : ""}
                        {am.domNodesSent != null ? ` · ${am.domNodesSent} page elements considered` : null}
                      </dd>
                      <details className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-500">
                          Technical names
                        </summary>
                        <div className="mt-1.5 space-y-1 font-mono text-[10px]">
                          {am.textModel ? <p>Model: {am.textModel}</p> : null}
                          {am.imageModel ? <p>Image: {am.imageModel}</p> : null}
                          {meta.document ? (
                            <p>
                              Page size: {meta.document.scrollWidth}×{meta.document.scrollHeight}px
                            </p>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  ) : null}
                </dl>
                {session.viewportPreviewJpegBase64 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium text-zinc-500">Snapshot</span>
                    <img
                      alt=""
                      className="w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                      src={`data:image/jpeg;base64,${session.viewportPreviewJpegBase64}`}
                    />
                  </div>
                ) : (
                  <p className="self-center text-center text-[10px] text-zinc-500">No snapshot saved</p>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {!needsGeminiGate && tab === "page" && !session ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500">
            Run a review from <span className="font-medium text-zinc-700 dark:text-zinc-300">Home</span> first.
          </div>
        ) : null}

        {!needsGeminiGate && tab === "log" && session?.analysisLog?.length ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <p className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
              Step-by-step log for support or debugging. Most people do not need this.
            </p>
            <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-emerald-100 dark:border-zinc-800">
              {session.analysisLog.join("\n")}
            </pre>
          </div>
        ) : null}
      </main>
    </div>
  );
}
