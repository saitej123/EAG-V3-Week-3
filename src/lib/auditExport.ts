import type { AuditIssue, AuditSessionStored } from "../types/audit";

function appendPatches(parts: string[], issue: AuditIssue) {
  const p = issue.codePatches;
  if (!p) return;
  if (p.css) {
    parts.push(`#### CSS`, ``, "```css", p.css, "```", ``);
  }
  if (p.html) {
    parts.push(`#### HTML`, ``, "```html", p.html, "```", ``);
  }
  if (p.aria) {
    parts.push(`#### ARIA`, ``, "```", p.aria, "```", ``);
  }
}

export function auditToMarkdown(session: AuditSessionStored): string {
  const { meta, response, analyzedAt, domNodeCount } = session;
  const { summary, issues, notes } = response;

  const parts: string[] = [
    `# FairFrame — UX & accessibility review`,
    ``,
    `- **URL:** ${meta.url}`,
    `- **Title:** ${meta.title}`,
    `- **Viewport profile:** ${meta.viewportProfile} (${meta.viewport.width}×${meta.viewport.height} @ ${meta.viewport.devicePixelRatio}x DPR)`,
    `- **Analyzed:** ${new Date(analyzedAt).toISOString()}`,
    `- **DOM nodes sent:** ${domNodeCount}`,
  ];
  if ("document" in meta && meta.document) {
    const d = meta.document;
    parts.push(
      `- **Document:** ${d.scrollWidth}×${d.scrollHeight}px scroll size · scroll (${d.scrollX}, ${d.scrollY})`,
    );
  }
  if (session.analysisMeta?.screenshotStripCount != null) {
    parts.push(`- **Screenshot strips (VLM):** ${session.analysisMeta.screenshotStripCount}`);
  }
  if (session.comparison) {
    const c = session.comparison;
    parts.push(
      `- **vs prior run** (${new Date(c.previousAnalyzedAt).toISOString()}): likely fixed ${c.likelyResolved}, likely new ${c.likelyNew}, same signature ${c.likelyUnchanged} (heuristic)`,
    );
  }
  if (notes) parts.push(`- **Notes:** ${notes}`);
  parts.push(
    ``,
    `## Summary`,
    ``,
    `| Metric | Count |`,
    `| --- | ---: |`,
    `| Total | ${summary.total} |`,
    `| Critical | ${summary.critical} |`,
    `| Major | ${summary.major} |`,
    `| Minor | ${summary.minor} |`,
    `| Suggestion | ${summary.suggestion} |`,
    ``,
    `## Findings`,
    ``,
  );

  for (const issue of issues) {
    parts.push(`### [${issue.severity.toUpperCase()}] ${issue.type} (${issue.category})`, ``);
    if (issue.analysisTags?.length) {
      parts.push(`**Tags:** ${issue.analysisTags.join(", ")}`, ``);
    }
    if (issue.boundingBox) {
      const b = issue.boundingBox;
      parts.push(
        `**BBox:** ${Math.round(b.x)}, ${Math.round(b.y)} · ${Math.round(b.width)}×${Math.round(b.height)}`,
        ``,
      );
    }
    if (issue.wcagReference) {
      parts.push(`**WCAG:** ${issue.wcagReference}`, ``);
    }
    parts.push(`**Summary:** ${issue.description}`, ``);
    if (issue.advancedRationale) {
      parts.push(`**Technical rationale:**`, ``, issue.advancedRationale, ``);
    }
    parts.push(`**Impacted:** ${issue.impactedUsers.join(", ")}`, ``);
    if (issue.implementationChecklist?.length) {
      parts.push(`**Implementation checklist:**`, ``);
      issue.implementationChecklist.forEach((step) => parts.push(`- ${step}`));
      parts.push(``);
    }
    parts.push(`**Primary fix:**`, ``, "```", issue.suggestedFix, "```", ``);
    appendPatches(parts, issue);
    parts.push(`**Selector:** \`${issue.selector.replace(/`/g, "\\`")}\``, ``);
    if (issue.mockupCaption || issue.mockupImageBase64) {
      parts.push(
        `**Visual mockup:** ${issue.mockupCaption || "(generated)"} — *binary image is included in the JSON export only.*`,
        ``,
      );
    }
    parts.push(`---`, ``);
  }

  return parts.join("\n");
}

export function auditToJson(session: AuditSessionStored): string {
  return JSON.stringify(session, null, 2);
}
