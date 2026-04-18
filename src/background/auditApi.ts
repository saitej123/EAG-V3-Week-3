import type {
  AuditAnalyzeResponse,
  AuditCodePatches,
  AuditDomNode,
  AuditIssue,
  AuditRequestPayload,
  AuditSummary,
} from "../types/audit";
import { DEFAULT_GEMINI_AUDIT_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, getAuditSettings, isDemoApiBase } from "./auditSettings";
import { analyzeAuditWithGemini } from "./geminiAudit";
import { generateAuditMockupImage } from "./geminiImageMockup";

function analyzeUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  if (b.endsWith("/analyze")) return b;
  return `${b}/analyze`;
}

export type ImageMockupPlanItem = { issueId: string; generationPrompt: string };

function extractImageMockupPlan(parsed: unknown): ImageMockupPlanItem[] {
  const d = parsed as { imageMockupPlan?: unknown };
  if (!Array.isArray(d.imageMockupPlan)) return [];
  return d.imageMockupPlan
    .filter((p): p is ImageMockupPlanItem => {
      if (!p || typeof p !== "object") return false;
      const o = p as Record<string, unknown>;
      return typeof o.issueId === "string" && typeof o.generationPrompt === "string";
    })
    .slice(0, 2);
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function pickStrArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return out.length ? out : undefined;
}

function pickPatches(v: unknown): AuditCodePatches | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const css = pickStr(o.css);
  const html = pickStr(o.html);
  const aria = pickStr(o.aria);
  if (!css && !html && !aria) return undefined;
  return { css, html, aria };
}

/** Fill missing boundingBox from DOM snapshot so page overlays align. */
export function enrichIssuesFromDomSnapshot(issues: AuditIssue[], nodes: AuditDomNode[]): void {
  const bySelector = new Map<string, AuditDomNode["box"]>();
  for (const n of nodes) {
    if (!bySelector.has(n.selector)) bySelector.set(n.selector, n.box);
  }
  for (const issue of issues) {
    const bb = issue.boundingBox;
    if (bb && bb.width > 0 && bb.height > 0) continue;
    let box = bySelector.get(issue.selector);
    if (!box) {
      const hit = nodes.find((n) => n.selector === issue.selector);
      if (hit) box = hit.box;
    }
    if (!box) {
      const sub = nodes.find((n) => issue.selector.includes(n.selector) && n.selector.length >= 4);
      if (sub) box = sub.box;
    }
    if (box && box.width > 0 && box.height > 0) {
      issue.boundingBox = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
  }
}

type BoundingBoxLike = { x: number; y: number; width: number; height: number };

export function normalizeResponse(data: unknown): AuditAnalyzeResponse {
  const d = data as Partial<AuditAnalyzeResponse>;
  const issues = Array.isArray(d.issues) ? d.issues : [];
  const mapped: AuditIssue[] = issues.map((raw, idx) => {
    const i = raw as Record<string, unknown>;
    return {
      id: String(i.id || `issue-${idx + 1}`),
      selector: String(i.selector || ""),
      category:
        i.category === "seo" || i.category === "accessibility" || i.category === "ux" ? i.category : "ux",
      type: String(i.type || "general"),
      severity:
        i.severity === "critical" || i.severity === "major" || i.severity === "minor" || i.severity === "suggestion"
          ? i.severity
          : "suggestion",
      description: String(i.description || ""),
      impactedUsers: Array.isArray(i.impactedUsers) ? i.impactedUsers.map(String) : [],
      suggestedFix: String(i.suggestedFix || ""),
      wcagReference: pickStr(i.wcagReference),
      boundingBox:
        i.boundingBox &&
        typeof i.boundingBox === "object" &&
        typeof (i.boundingBox as BoundingBoxLike).x === "number" &&
        typeof (i.boundingBox as BoundingBoxLike).y === "number" &&
        typeof (i.boundingBox as BoundingBoxLike).width === "number" &&
        typeof (i.boundingBox as BoundingBoxLike).height === "number"
          ? (i.boundingBox as AuditIssue["boundingBox"])
          : undefined,
      advancedRationale: pickStr(i.advancedRationale),
      implementationChecklist: pickStrArr(i.implementationChecklist),
      codePatches: pickPatches(i.codePatches),
      analysisTags: pickStrArr(i.analysisTags) ?? pickStrArr(i.tags),
    };
  });

  const recount: AuditSummary = {
    total: mapped.length,
    critical: mapped.filter((i) => i.severity === "critical").length,
    major: mapped.filter((i) => i.severity === "major").length,
    minor: mapped.filter((i) => i.severity === "minor").length,
    suggestion: mapped.filter((i) => i.severity === "suggestion").length,
  };

  /** Always derive counts from parsed issues so UI chips match the findings list (model summary often drifts). */
  return {
    summary: recount,
    issues: mapped,
    notes: typeof d.notes === "string" ? d.notes : undefined,
  };
}

function issueContextForImage(issue: AuditIssue): string {
  return [
    `id: ${issue.id}`,
    `selector: ${issue.selector}`,
    `severity: ${issue.severity}`,
    `type: ${issue.type}`,
    `description: ${issue.description}`,
    `suggestedFix: ${issue.suggestedFix}`,
    issue.advancedRationale ? `advancedRationale: ${issue.advancedRationale}` : "",
    issue.wcagReference ? `wcag: ${issue.wcagReference}` : "",
    issue.analysisTags?.length ? `tags: ${issue.analysisTags.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function attachGeminiMockups(
  issues: AuditIssue[],
  plan: ImageMockupPlanItem[],
  opts: {
    apiKey: string;
    imageModel: string;
    viewportJpeg: string | null;
  },
): Promise<void> {
  for (const item of plan) {
    const issue = issues.find((x) => x.id === item.issueId);
    if (!issue) continue;
    try {
      const { imageBase64, mime, caption } = await generateAuditMockupImage({
        apiKey: opts.apiKey,
        model: opts.imageModel,
        viewportJpegBase64: opts.viewportJpeg,
        issueContext: issueContextForImage(issue),
        generationPrompt: item.generationPrompt,
      });
      if (imageBase64) {
        issue.mockupImageBase64 = imageBase64;
        issue.mockupImageMime = mime;
        issue.mockupCaption = caption || issue.mockupCaption;
      }
    } catch {
      /* optional path — skip mockup on API or safety errors */
    }
  }
}

export async function postAuditAnalyze(
  payload: AuditRequestPayload,
  activeTabId?: number,
  onLog?: (msg: string) => void
): Promise<AuditAnalyzeResponse> {
  const settings = await getAuditSettings();
  const { apiBaseUrl, apiKey, geminiApiKey, geminiModel, geminiImageModel, geminiMockupsEnabled } = settings;

  if (!isDemoApiBase(apiBaseUrl)) {
    const url = analyzeUrl(apiBaseUrl);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Review server ${res.status}: ${t.slice(0, 200) || res.statusText}`);
    }
    const json = await res.json();
    const out = normalizeResponse(json);
    enrichIssuesFromDomSnapshot(out.issues, payload.dom.nodes);
    return out;
  }

  if (geminiApiKey) {
    const model = geminiModel.trim() || DEFAULT_GEMINI_AUDIT_MODEL;
    const { parsed, notesExtra } = await analyzeAuditWithGemini({
      apiKey: geminiApiKey,
      model,
      payload,
      activeTabId: activeTabId || 0,
      onLog: onLog || (() => {}),
    });
    const plan = extractImageMockupPlan(parsed);
    const out = normalizeResponse(parsed);
    enrichIssuesFromDomSnapshot(out.issues, payload.dom.nodes);
    out.notes = [out.notes, notesExtra].filter(Boolean).join(" — ");

    if (geminiMockupsEnabled && plan.length > 0) {
      const imgModel = geminiImageModel.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
      await attachGeminiMockups(out.issues, plan, {
        apiKey: geminiApiKey,
        imageModel: imgModel,
        viewportJpeg: payload.screenshotViewportJpegBase64,
      });
      const mockNote = `Mockups: ${imgModel} (up to ${plan.length} image${plan.length > 1 ? "s" : ""}).`;
      out.notes = [out.notes, mockNote].filter(Boolean).join(" — ");
    }

    return out;
  }

  throw new Error(
    "FairFrame needs a Gemini API key when using the default review host. Open Settings and paste your key from Google AI Studio.",
  );
}
