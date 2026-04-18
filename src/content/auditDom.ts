import type { AuditDomNode, AuditRequestMeta, BoundingBoxDoc, ViewportProfile } from "../types/audit";
import {
  readScrollMetrics,
  resetFairFrameScrollSession,
  restoreScrollState,
  saveScrollState,
  setPrimaryScroll,
} from "./fairframeScroll";

const OVERLAY_ID = "__ux_audit_overlay_root__";
const MAX_NODES = 420;
const MAX_CANDIDATE_ELS = 520;

function escapeCssIdent(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function buildSelector(el: Element): string {
  if (el.id) return `#${escapeCssIdent(el.id)}`;
  const parts: string[] = [];
  let e: Element | null = el;
  for (let depth = 0; e && e.nodeType === 1 && depth < 6; depth++) {
    let sel = e.tagName.toLowerCase();
    if (e.className && typeof e.className === "string") {
      const cls = e.className
        .trim()
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("ng-"))
        .slice(0, 2)
        .map((c) => `.${escapeCssIdent(c)}`)
        .join("");
      if (cls) sel += cls;
    }
    const parentEl: Element | null = e.parentElement;
    if (parentEl) {
      const sameTag = [...parentEl.children].filter((x) => x.tagName === e!.tagName);
      if (sameTag.length > 1) {
        const idx = sameTag.indexOf(e) + 1;
        sel += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(sel);
    if (e.id) break;
    e = parentEl;
  }
  return parts.join(" > ");
}

function docBox(el: Element): BoundingBoxDoc {
  const r = el.getBoundingClientRect();
  const x = r.left + window.scrollX;
  const y = r.top + window.scrollY;
  return {
    x,
    y,
    width: r.width,
    height: r.height,
  };
}

function visibleInViewport(box: BoundingBoxDoc): boolean {
  const vx = window.scrollX;
  const vy = window.scrollY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return box.x + box.width > vx && box.x < vx + vw && box.y + box.height > vy && box.y < vy + vh;
}

function ariaMap(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of el.attributes) {
    if (a.name.startsWith("aria-")) out[a.name] = a.value.slice(0, 240);
  }
  return out;
}

function accessibleName(el: Element): string | null {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const pieces = ids
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean) as string[];
    if (pieces.length) return pieces.join(" ").slice(0, 400);
  }
  const al = el.getAttribute("aria-label");
  if (al?.trim()) return al.trim().slice(0, 400);
  if (el instanceof HTMLImageElement) {
    const t = el.getAttribute("alt");
    if (t != null) return t.slice(0, 400);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.id) {
      const labels = document.getElementsByTagName("label");
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].htmlFor === el.id) {
          const t = labels[i].textContent?.trim();
          if (t) return t.slice(0, 400);
        }
      }
    }
    const wrap = el.closest("label");
    const t = wrap?.textContent?.trim();
    if (t) return t.slice(0, 400);
  }
  const t = el.textContent?.trim();
  if (t && t.length < 200) return t;
  return null;
}

function isInteractiveCandidate(el: Element): boolean {
  const t = el.tagName.toLowerCase();
  return !(t === "img" || /^h[1-6]$/i.test(t));
}

function docScrollHeight(): number {
  const root = document.scrollingElement || document.documentElement;
  return Math.max(
    root.scrollHeight,
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
    document.documentElement.offsetHeight,
  );
}

export type AuditScrollExpandOptions = {
  scrollBeforeCapture: boolean;
  scrollMaxMs: number;
  scrollMaxViewportHeights: number;
};

/**
 * Scrolls from top → bottom (and back) so lazy lists and infinite feeds hydrate before DOM collect.
 */
export async function expandPageByScrolling(opts: AuditScrollExpandOptions): Promise<{
  scrollExpanded: boolean;
  scrollUsedMs: number;
  steps: number;
}> {
  if (!opts.scrollBeforeCapture) {
    return { scrollExpanded: false, scrollUsedMs: 0, steps: 0 };
  }

  resetFairFrameScrollSession();
  const t0 = Date.now();
  const saved = saveScrollState();
  let steps = 0;
  let y = 0;

  setPrimaryScroll(0);
  await new Promise((r) => setTimeout(r, 220));

  for (;;) {
    if (steps >= opts.scrollMaxViewportHeights || Date.now() - t0 >= opts.scrollMaxMs) {
      break;
    }

    const m = readScrollMetrics();
    const ih = Math.max(1, m.viewportH);
    const bottom = Math.max(0, m.scrollHeight - ih);
    y = Math.min(y, bottom);
    setPrimaryScroll(y);
    steps++;
    await new Promise((r) => setTimeout(r, 280));

    const m2 = readScrollMetrics();
    const bottom2 = Math.max(0, m2.scrollHeight - m2.viewportH);
    if (y >= bottom2 - 8) {
      setPrimaryScroll(bottom2);
      await new Promise((r) => setTimeout(r, 320));
      break;
    }

    y += Math.max(1, Math.floor(m.viewportH * 0.88));
  }

  restoreScrollState(saved);
  await new Promise((r) => setTimeout(r, 140));

  return { scrollExpanded: true, scrollUsedMs: Date.now() - t0, steps };
}

function gatherCandidateElements(doc: Document): Element[] {
  const set = new Set<Element>();
  const q = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ].join(",");
  doc.querySelectorAll(q).forEach((el) => set.add(el));
  return [...set];
}

function styleSnapshot(el: Element) {
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    width: cs.width,
    height: cs.height,
  };
}

export function collectDomAuditSnapshot(profile: ViewportProfile): {
  nodes: AuditDomNode[];
  meta: AuditRequestMeta;
} {
  const candidates = gatherCandidateElements(document);
  const sorted = [...candidates].sort((a, b) => {
    const ba = docBox(a);
    const bb = docBox(b);
    const va = visibleInViewport(ba) && ba.width > 0 && ba.height > 0 ? 0 : 1;
    const vb = visibleInViewport(bb) && bb.width > 0 && bb.height > 0 ? 0 : 1;
    if (va !== vb) return va - vb;
    const ia = isInteractiveCandidate(a);
    const ib = isInteractiveCandidate(b);
    if (ia !== ib) return ia ? -1 : 1;
    return ba.y - bb.y;
  });

  const cappedEls = sorted.slice(0, MAX_CANDIDATE_ELS);
  const nodes: AuditDomNode[] = [];

  const pushNode = (el: Element) => {
    if (nodes.length >= MAX_NODES) return;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const box = docBox(el);
    const node: AuditDomNode = {
      selector: buildSelector(el),
      tag,
      role: role || null,
      name: accessibleName(el),
      headingLevel: /^h[1-6]$/i.test(tag) ? Number(tag[1]) : null,
      href:
        el instanceof HTMLAnchorElement
          ? el.href.slice(0, 500)
          : (el.getAttribute("href")?.slice(0, 500) ?? null),
      inputType: el instanceof HTMLInputElement ? el.type : null,
      alt: el instanceof HTMLImageElement ? el.getAttribute("alt") : null,
      aria: ariaMap(el),
      box,
      styles: styleSnapshot(el),
      visible: visibleInViewport(box) && box.width > 0 && box.height > 0,
    };
    nodes.push(node);
  };

  for (const el of cappedEls) {
    pushNode(el);
    if (nodes.length >= MAX_NODES) break;
  }

  const scrollHeight = docScrollHeight();
  const scrollWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body?.scrollWidth ?? 0,
    document.documentElement.offsetWidth,
  );

  const meta: AuditRequestMeta = {
    url: location.href,
    title: document.title,
    viewportProfile: profile,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    document: {
      scrollHeight,
      scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollY: window.scrollY,
      scrollX: window.scrollX,
    },
    capturedAt: Date.now(),
  };

  return { nodes, meta };
}

export type OverlayIssue = {
  id: string;
  selector: string;
  severity: import("../types/audit").AuditSeverity;
  description: string;
  impactedUsers: string[];
  suggestedFix: string;
  boundingBox?: BoundingBoxDoc;
};

const SEVERITY_BORDER: Record<OverlayIssue["severity"], string> = {
  critical: "rgba(220, 38, 38, 0.95)",
  major: "rgba(234, 88, 12, 0.95)",
  minor: "rgba(234, 179, 8, 0.9)",
  suggestion: "rgba(37, 99, 235, 0.85)",
};

function ensureOverlayHost(): HTMLDivElement {
  let root = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (root) return root;
  root = document.createElement("div");
  root.id = OVERLAY_ID;
  root.setAttribute("data-ux-audit-overlay", "true");
  root.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "width:100%",
    `min-height:${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`,
    "z-index:2147483646",
    "pointer-events:none",
    "box-sizing:border-box",
  ].join(";");
  document.documentElement.appendChild(root);
  return root;
}

function removeOverlayHost() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function makeCard(issue: OverlayIssue): HTMLDivElement {
  const box = issue.boundingBox;
  const el = document.createElement("div");
  el.className = "__ux_audit_marker__";
  el.dataset.issueId = issue.id;
  const border = SEVERITY_BORDER[issue.severity];
  el.style.cssText = [
    "position:absolute",
    "box-sizing:border-box",
    "pointer-events:auto",
    `border:2px solid ${border}`,
    "border-radius:6px",
    "background:rgba(0,0,0,0.04)",
    "cursor:pointer",
    "transition:box-shadow 0.15s ease",
  ].join(";");
  if (box) {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  }

  const pop = document.createElement("div");
  pop.className = "__ux_audit_pop__";
  pop.style.cssText = [
    "position:absolute",
    "left:0",
    "top:100%",
    "margin-top:6px",
    "min-width:220px",
    "max-width:min(360px,90vw)",
    "padding:10px 12px",
    "border-radius:8px",
    "background:#0a0a0a",
    "color:#fafafa",
    "font:12px/1.45 system-ui,sans-serif",
    "box-shadow:0 12px 40px rgba(0,0,0,0.35)",
    "border:1px solid rgba(255,255,255,0.12)",
    "opacity:0",
    "visibility:hidden",
    "transform:translateY(4px)",
    "transition:opacity 0.12s ease,transform 0.12s ease,visibility 0.12s",
    "z-index:2",
    "pointer-events:none",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = issue.severity.toUpperCase();
  title.style.cssText = "font-size:10px;font-weight:700;letter-spacing:0.08em;opacity:0.75;margin-bottom:6px";
  const desc = document.createElement("div");
  desc.textContent = issue.description;
  desc.style.cssText = "margin-bottom:8px";
  const users = document.createElement("div");
  users.innerHTML = `<strong style="opacity:.8">Impacted</strong><br/>${issue.impactedUsers.map((u) => `· ${u}`).join("<br/>")}`;
  users.style.cssText = "margin-bottom:8px;font-size:11px;opacity:0.95";
  const fix = document.createElement("pre");
  fix.textContent = issue.suggestedFix;
  fix.style.cssText =
    "white-space:pre-wrap;word-break:break-word;margin:0;padding:8px;border-radius:6px;background:#171717;border:1px solid rgba(255,255,255,0.08);font:11px/1.4 ui-monospace,monospace";

  pop.append(title, desc, users, fix);
  el.appendChild(pop);

  el.addEventListener("mouseenter", () => {
    pop.style.opacity = "1";
    pop.style.visibility = "visible";
    pop.style.transform = "translateY(0)";
  });
  el.addEventListener("mouseleave", () => {
    pop.style.opacity = "0";
    pop.style.visibility = "hidden";
    pop.style.transform = "translateY(4px)";
  });
  el.addEventListener(
    "click",
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = pop.style.visibility === "visible";
      pop.style.opacity = open ? "0" : "1";
      pop.style.visibility = open ? "hidden" : "visible";
      pop.style.transform = open ? "translateY(4px)" : "translateY(0)";
    },
    true,
  );

  return el;
}

export function renderAuditOverlay(issues: OverlayIssue[]) {
  removeOverlayHost();
  const host = ensureOverlayHost();

  for (const issue of issues) {
    let box = issue.boundingBox;
    if (!box) {
      try {
        const found = document.querySelector(issue.selector);
        if (found) box = docBox(found);
      } catch {
        /* invalid selector */
      }
    }
    if (!box || box.width < 1 || box.height < 1) continue;
    const card = makeCard({ ...issue, boundingBox: box });
    host.appendChild(card);
  }
}

export function setOverlayVisible(visible: boolean) {
  const root = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (!root) return;
  root.style.display = visible ? "" : "none";
}

export function clearAuditOverlay() {
  removeOverlayHost();
}
