/** Viewport profile sent to the backend (actual window size is included separately). */
export type ViewportProfile = "desktop" | "tablet" | "mobile";

export type AuditSeverity = "critical" | "major" | "minor" | "suggestion";

export type BoundingBoxDoc = {
  /** Document-space coordinates (scroll included). */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AuditDomNode = {
  selector: string;
  tag: string;
  role: string | null;
  /** Accessible name hint (aria-label, alt, associated label, or short text). */
  name: string | null;
  headingLevel: number | null;
  href: string | null;
  inputType: string | null;
  alt: string | null;
  /** Trimmed ARIA attributes (role handled separately). */
  aria: Record<string, string>;
  box: BoundingBoxDoc;
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    lineHeight: string;
    width: string;
    height: string;
  };
  visible: boolean;
};

export type AuditRequestMeta = {
  url: string;
  title: string;
  viewportProfile: ViewportProfile;
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** Full document geometry at collect time (DOM includes nodes outside the visible viewport). */
  document?: {
    scrollHeight: number;
    scrollWidth: number;
    clientWidth: number;
    clientHeight: number;
    scrollY: number;
    scrollX: number;
  };
  /** Content script walked the page before DOM collect (lazy-loaded regions). */
  scrollExpansion?: {
    didRun: boolean;
    steps: number;
    usedMs: number;
  };
  capturedAt: number;
};

export type AuditRequestPayload = {
  meta: AuditRequestMeta;
  /** Top / primary JPEG (base64, no data URL prefix). Same as the first strip when scrolling capture runs. */
  screenshotViewportJpegBase64: string | null;
  /** Additional JPEG strips while scrolling (overlapping). Omitted on short pages. */
  screenshotScrollStripsJpegBase64?: string[];
  /** Prior run on same page (local history) so the model can reason about regressions and fixes. */
  priorAuditContext?: string;
  dom: {
    nodes: AuditDomNode[];
  };
};

export type AuditCodePatches = {
  css?: string;
  html?: string;
  aria?: string;
};

export type AuditIssue = {
  id: string;
  /** CSS selector the content script can resolve for highlights. */
  selector: string;
  category: "ux" | "accessibility" | "seo";
  type: string;
  severity: AuditSeverity;
  /** Short executive summary (still include depth below). */
  description: string;
  impactedUsers: string[];
  /** Primary fix: can mix CSS / HTML / ARIA as text. */
  suggestedFix: string;
  wcagReference?: string;
  /** If omitted, overlay tries to resolve `selector` on the page. Prefer copying `box` from the DOM snapshot for that selector. */
  boundingBox?: BoundingBoxDoc;
  /** Model tags e.g. non_obvious, structural, keyboard, motion, i18n, forms_deep, seo_deep, performance_ux, dom_inferred. */
  analysisTags?: string[];
  /** Senior-level: evidence, trade-offs, WCAG level (AA/AAA), regression risk. */
  advancedRationale?: string;
  /** Implementation & QA checklist for engineers. */
  implementationChecklist?: string[];
  /** Copy-paste oriented snippets. */
  codePatches?: AuditCodePatches;
  /** Optional mockup from Gemini image model (raw base64, no data-URL prefix). */
  mockupImageBase64?: string;
  /** e.g. image/png — defaults to PNG in UI if omitted. */
  mockupImageMime?: string;
  mockupCaption?: string;
};

export type AuditSummary = {
  total: number;
  critical: number;
  major: number;
  minor: number;
  suggestion: number;
};

export type AuditAnalyzeResponse = {
  summary: AuditSummary;
  issues: AuditIssue[];
  /** Optional raw model notes for debugging. */
  notes?: string;
};

export type AuditSessionResult = {
  payload: AuditRequestPayload;
  response: AuditAnalyzeResponse;
  analyzedAt: number;
};

/** How the last audit was produced (for dev transparency). */
export type AuditAnalysisMeta = {
  engine: "gemini" | "custom_http";
  textModel?: string;
  imageModel?: string;
  hadViewportScreenshot: boolean;
  /** How many JPEGs were attached (1 = viewport only; more = scrolled full-page capture). */
  screenshotStripCount?: number;
  domNodesSent: number;
  tabTitle?: string;
  tabUrl?: string;
};

/** Heuristic diff vs last stored run on the same page (selector+type+severity fingerprints). */
export type AuditRunComparison = {
  previousAnalyzedAt: number;
  previousTotal: number;
  likelyNew: number;
  likelyResolved: number;
  likelyUnchanged: number;
};

/** Persisted without screenshot / full DOM to stay within storage quotas. */
export type AuditSessionStored = {
  meta: AuditRequestMeta;
  response: AuditAnalyzeResponse;
  analyzedAt: number;
  domNodeCount: number;
  /** Viewport JPEG (base64) fed to VLM — may be dropped if session storage quota is tight. */
  viewportPreviewJpegBase64?: string | null;
  /** Timestamped lines from the service worker (capture → model → overlay). */
  analysisLog?: string[];
  analysisMeta?: AuditAnalysisMeta;
  /** Present when a prior local run existed for this URL. */
  comparison?: AuditRunComparison;
};

/** Static WCAG mappings for labels in UI / exports (extend as needed). */
export const WCAG_REFERENCE_MAP: Record<string, string> = {
  contrast: "WCAG 2.2 — 1.4.3 Contrast (Minimum)",
  contrastLarge: "WCAG 2.2 — 1.4.3 Contrast (Minimum) (large text)",
  nonTextContrast: "WCAG 2.2 — 1.4.11 Non-text Contrast",
  focusVisible: "WCAG 2.2 — 2.4.7 Focus Visible",
  nameRoleValue: "WCAG 2.2 — 4.1.2 Name, Role, Value",
  linkPurpose: "WCAG 2.2 — 2.4.4 Link Purpose (In Context)",
  labels: "WCAG 2.2 — 3.3.2 Labels or Instructions",
  targetSize: "WCAG 2.2 — 2.5.5 Target Size (Enhanced) / 2.5.8 Target Size (Minimum)",
  imagesOfText: "WCAG 2.2 — 1.4.5 Images of Text",
};
