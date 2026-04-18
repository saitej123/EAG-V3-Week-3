/**
 * FairFrame → Google Gemini API (generateContent, v1beta).
 * JSON output: https://ai.google.dev/gemini-api/docs/json-mode
 */
import type { AuditRequestPayload } from "../types/audit";

const MAX_NODES_FOR_GEMINI = 380;
const MAX_JSON_CHARS = 195_000;
/** Matches capture: tiled overlapping strips (see fullPageCapture, max 32). */
const MAX_VLM_IMAGES = 32;

const JSON_SCHEMA_HINT = `Return **one raw JSON object only** (no markdown, no \`\`\` fences, no commentary before or after). If you use structured output, still avoid any extra text outside the JSON.

{
  "summary": { "total": number, "critical": number, "major": number, "minor": number, "suggestion": number },
  "issues": [
    {
      "id": string (stable id e.g. "ux-1", "a11y-2"),
      "selector": string (prefer exact selector from DOM snapshot),
      "category": "ux" | "accessibility" | "seo",
      "type": string (snake_case id),
      "severity": "critical" | "major" | "minor" | "suggestion",
      "description": string (1–2 sentence exec summary),
      "impactedUsers": string[],
      "suggestedFix": string (detailed: may include CSS blocks, HTML snippets, ARIA — use clear section labels),
      "wcagReference": string (optional; cite WCAG 2.2 success criterion when applicable),
      "boundingBox": { "x": number, "y": number, "width": number, "height": number } — **required** when the DOM snapshot contains a node with this exact selector: copy numeric values from that node's "box" (document coordinates). If no match, omit and explain in advancedRationale.
      "analysisTags": string[] (optional; 1–5 tags per issue from: visual_obvious, non_obvious, structural, dom_inferred, keyboard, focus, motion_reduced, forms_deep, i18n_risk, seo_deep, performance_ux, trust_safety, content_hierarchy, visual_design, layout_spacing, typography_readability, ia_navigation, copy_tone, affordance, cognitive_load, brand_consistency, pattern_expectations, perceived_performance, marketing_ux_tension),
      "advancedRationale": string (required for major/critical; **strongly recommended** for minor when the critique is visual/UX-subjective: what you saw in strips or DOM, why it hurts users, alternative patterns),
      "implementationChecklist": string[] (concrete steps: implement, unit/a11y test, visual QA, rollout),
      "codePatches": { "css": string (optional), "html": string (optional), "aria": string (optional) } (optional)
    }
  ],
  "imageMockupPlan": [
    { "issueId": string, "generationPrompt": string }
  ] (optional; 0–2 items ONLY for issues where a visual mockup materially helps — layout/hierarchy/tap-target/cluster problems; omit for pure copy-only fixes),
  "notes": string (optional; methodology, limits, or follow-up audits)
}`;

function buildSystemInstruction(): string {
  return `You are a **principal product designer + design critic + frontend/a11y lead** reviewing a real page for an experienced team. Be **constructive but direct**: name what feels weak, generic, confusing, or unpolished—like a candid design review, not a compliance checkbox.

Audience: senior ICs and tech leads. **Never** hand-wave ("consider improving UX"); always tie critique to **what appears in the screenshots or DOM** and propose a **concrete** fix.

Inputs:
1) One or more JPEGs: **overlapping viewport strips** ordered **top → bottom** along the document (not a single stitched image). Adjacent strips share ~15–20% vertical overlap. Fixed headers may repeat across strips. If only one image, the full page fit in one viewport.
2) JSON DOM snapshot: selectors, roles, ARIA, names, boxes in **document coordinates** (scroll offsets included), computed colors, typography, and a "visible" boolean for viewport intersection at collect time. Nodes below the fold often have visible:false but are still in scope—audit them for footer, sticky bars, modals, and long-form content.
3) meta.document (when present) gives scrollWidth/scrollHeight and scroll position—use it to reason about content not shown in any strip.

**Breadth (UX + UI critic scope — actively hunt for issues):**
- **Visual & layout:** hierarchy (what draws the eye first?), alignment grids, spacing rhythm, section separation, density/clutter, card/list consistency, responsive awkwardness visible in strips.
- **Typography & readability:** scale steps, heading vs body contrast, line length feel, truncation risks, all-caps overuse, label vs body distinction.
- **Color & affordance:** primary vs secondary CTAs, disabled/loading states (infer from DOM/classes if visible), link vs text distinction, noisy backgrounds hurting scan.
- **IA & navigation:** nav clarity, duplicate paths, mystery meat icons, footer sitemap density, where users might feel lost.
- **Copy & microcopy:** tone mismatches, jargon, vague CTAs ("Submit" vs outcome), error/help text quality, trust copy vs hype.
- **Patterns & expectations:** cancel/save placement, destructive actions, back behavior, modal vs non-modal flows, carousel abuse, autoplay risk.
- **Trust & perceived quality:** stock-photo feel, social-proof placement, pricing clarity, legal/privacy discoverability, broken visual polish (misaligned icons, inconsistent radii).
- **Cognitive load:** competing CTAs, redundant sections, tables of contents vs wall of text, animation distraction (infer from structure; tag motion_reduced when relevant).
- **Classic a11y/SEO:** still required where evidence exists—keyboard, focus, semantics, headings, meta—plus the deeper items below.

Rules:
- Tie claims to snapshot data or pixels in the strips. State uncertainty when inferring (e.g. keyboard traps) rather than hallucinating.
- **Issue count:** On a typical marketing, product, or content-heavy page, aim for **at least ~15 issues** spanning UX, UI, a11y, and SEO (use **suggestion** for nuanced polish). If the page is truly tiny (e.g. single screen, few nodes), fewer is OK—**do not invent** problems without evidence.
- **Depth:** At least **45%** of issues should carry analysisTags including **non_obvious** and/or **structural** or **dom_inferred** OR **visual_design** / **layout_spacing** / **copy_tone** / **ia_navigation** — not only baseline contrast/button size.
- Use **category "ux"** for product/visual/IA/copy/pattern critiques; **accessibility** for disabilities law/WCAG; **seo** for discoverability/structure. Pick the **primary** lens per issue.
- If the user message includes PRIOR_RUN_CONTEXT, use it: regressions, likely fixes, new risks; skip stale noise.
- Below-the-fold and off-strip content: use DOM + document metrics and tags like **dom_inferred** when images do not show the element.
- **boundingBox** must match the DOM node's box when the selector exists in the JSON (same x,y,width,height numbers).
- For each issue, include **implementationChecklist** (3–6 bullets). **advancedRationale**: required for major/critical; for minor UI/UX critiques, still include a short rationale (what you observed + why it matters).
- codePatches should be copy-paste oriented (scoped selectors, minimal diffs). Use modern semantic HTML and ARIA patterns.
- suggestedFix must be technically or editorially actionable (sizes, contrast, copy rewrite examples, component pattern names).
- imageMockupPlan: at most 2 entries. Each generationPrompt must be rich art direction (layout, annotations, component states) for an image model to render a wireframe/mockup. Only when visuals clarify the fix.
- Prefer selectors from the provided DOM JSON so the extension overlay resolves.
- **Modals, dialogs, and overlays:** If JPEGs show a dimmed backdrop or centered dialog, treat it as a modal layer. Call out focus trap, Esc to dismiss, inert/aria-modal on backdrop, scroll lock, and whether highlights for obscured background content are misleading—prefer the **topmost interactive** control in z-order when bounding boxes conflict.

${JSON_SCHEMA_HINT}`;
}

function slimPayloadForGemini(payload: AuditRequestPayload): { jsonText: string; nodeCount: number } {
  let nodes = payload.dom.nodes.slice(0, MAX_NODES_FOR_GEMINI);
  const body = {
    meta: payload.meta,
    dom: { nodes },
  };
  let jsonText = JSON.stringify(body);
  while (jsonText.length > MAX_JSON_CHARS && nodes.length > 40) {
    nodes = nodes.slice(0, Math.floor(nodes.length * 0.85));
    jsonText = JSON.stringify({ meta: payload.meta, dom: { nodes } });
  }
  return { jsonText, nodeCount: nodes.length };
}

/**
 * Gemini sometimes wraps JSON in ```json fences or adds a short preamble despite responseMimeType.
 * See: https://ai.google.dev/gemini-api/docs/json-mode
 */
function stripOuterMarkdownFence(s: string): string {
  let t = s.trim();
  if (!t.startsWith("```")) return t;
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/\s*```\s*$/i, "");
  return t.trim();
}

/** First ```json ... ``` block that looks like an object (last wins if multiple). */
function extractJsonFromMarkdownBlocks(s: string): string | null {
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let best: string | null = null;
  while ((m = re.exec(s)) !== null) {
    const inner = m[1]?.trim();
    if (inner && inner.startsWith("{")) best = inner;
  }
  return best;
}

/** First top-level `{ ... }` by brace depth (respects strings). */
function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (c === '"' && !esc) {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseGeminiJsonText(raw: string): unknown {
  const trimmed = raw.trim();
  const attempts: string[] = [trimmed, stripOuterMarkdownFence(trimmed)];

  const fromBlock = extractJsonFromMarkdownBlocks(trimmed);
  if (fromBlock) attempts.push(fromBlock, stripOuterMarkdownFence(fromBlock));

  const balanced =
    extractBalancedJsonObject(trimmed) ||
    extractBalancedJsonObject(stripOuterMarkdownFence(trimmed)) ||
    (fromBlock ? extractBalancedJsonObject(fromBlock) : null);
  if (balanced) attempts.push(balanced);

  const seen = new Set<string>();
  for (const candidate of attempts) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return JSON.parse(candidate);
    } catch {
      /* next */
    }
  }

  const preview = trimmed.slice(0, 160).replace(/\s+/g, " ");
  throw new Error(
    `Gemini returned text that was not valid JSON after cleanup (markdown fences / extra prose). Snippet: ${preview}${trimmed.length > 160 ? "…" : ""}`,
  );
}

/**
 * Optional structured output schema (REST: generationConfig.responseJsonSchema).
 * https://ai.google.dev/gemini-api/docs/structured-output
 */
const AUDIT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      properties: {
        total: { type: "integer" },
        critical: { type: "integer" },
        major: { type: "integer" },
        minor: { type: "integer" },
        suggestion: { type: "integer" },
      },
      required: ["total", "critical", "major", "minor", "suggestion"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          selector: { type: "string" },
          category: { type: "string" },
          type: { type: "string" },
          severity: { type: "string" },
          description: { type: "string" },
          impactedUsers: { type: "array", items: { type: "string" } },
          suggestedFix: { type: "string" },
          wcagReference: { type: "string" },
          boundingBox: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
          analysisTags: { type: "array", items: { type: "string" } },
          advancedRationale: { type: "string" },
          implementationChecklist: { type: "array", items: { type: "string" } },
          codePatches: {
            type: "object",
            properties: {
              css: { type: "string" },
              html: { type: "string" },
              aria: { type: "string" },
            },
          },
        },
        required: ["id", "selector", "category", "type", "severity", "description", "impactedUsers", "suggestedFix"],
      },
    },
    imageMockupPlan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issueId: { type: "string" },
          generationPrompt: { type: "string" },
        },
        required: ["issueId", "generationPrompt"],
      },
    },
    notes: { type: "string" },
  },
  required: ["summary", "issues"],
};

import {
  agenticToolsSchema,
  calculate_color_contrast,
  test_hyperlink_health,
  simulate_focus_tabs,
  check_image_alt_texts,
  analyze_heading_hierarchy,
} from "./agentTools";

export async function analyzeAuditWithGemini(params: {
  apiKey: string;
  model: string;
  payload: AuditRequestPayload;
  activeTabId: number;
  onLog: (msg: string) => void;
}): Promise<{ parsed: unknown; notesExtra: string }> {
  const { apiKey, model, payload, activeTabId, onLog } = params;
  onLog("🤖 Agent initializing...");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { jsonText, nodeCount } = slimPayloadForGemini(payload);

  const stripSources: string[] = [];
  if (payload.screenshotViewportJpegBase64) stripSources.push(payload.screenshotViewportJpegBase64);
  if (payload.screenshotScrollStripsJpegBase64?.length) {
    for (const s of payload.screenshotScrollStripsJpegBase64) {
      if (s && !stripSources.includes(s)) stripSources.push(s);
    }
  }
  const imageStrips = stripSources.slice(0, MAX_VLM_IMAGES);
  const droppedStrips = stripSources.length - imageStrips.length;

  const stripHint =
    imageStrips.length === 0
      ? "No JPEG attached — rely on DOM JSON and meta only."
      : imageStrips.length === 1
        ? "One JPEG: top-of-page viewport (or full page if short)."
        : `There are ${imageStrips.length} overlapping JPEG strips in document order (top → bottom). Use every strip for layout/a11y; reconcile with DOM boxes in document coordinates.`;

  const scrollExp = payload.meta.scrollExpansion;
  const scrollExpNote =
    scrollExp?.didRun === true
      ? `Before the DOM snapshot, the page was auto-scrolled (${scrollExp.steps} step(s), ${scrollExp.usedMs}ms) to surface lazy-loaded content.\n`
      : "";

  const priorBlock = payload.priorAuditContext?.trim()
    ? `\n--- PRIOR_RUN_CONTEXT ---\n${payload.priorAuditContext.trim()}\n--- END PRIOR ---\n`
    : "";

  const userText = `Perform a **wide-scope UX + UI + accessibility + SEO audit**. Act as a **sharp design critic**: surface problems the team may have stopped noticing—visual hierarchy, layout, typography, IA, copy, trust, patterns, and polish—not only WCAG violations.

But FIRST, use your tools to test at least 1 color contrast, 1 hyperlink, simulate 5 keyboard tabs, check the image alt texts, and analyze the heading hierarchy. 
AFTER you have used the tools and gathered enough context, your VERY NEXT text response MUST be the final JSON report ONLY. Do not output any conversational prose before or after the JSON. 

${stripHint}
${scrollExpNote}${droppedStrips > 0 ? `\n(Note: ${droppedStrips} extra image strip(s) omitted — rely on DOM for gaps.)\n` : ""}
${priorBlock}
DOM snapshot (${nodeCount} nodes). meta includes URL, title, viewport, and document scroll geometry.

--- DOM_JSON ---
${jsonText}
--- END ---`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  for (let i = 0; i < imageStrips.length; i++) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageStrips[i]!,
      },
    });
  }
  parts.push({ text: userText });

  const conversationHistory: any[] = [{ role: "user", parts }];

  let isDone = false;
  let finalRawText = "";
  let loopCount = 0;
  const MAX_LOOPS = 15;

  while (!isDone && loopCount < MAX_LOOPS) {
    loopCount++;
    onLog(`💭 Agent is thinking (Turn ${loopCount})...`);

    // When we use function calling we MUST NOT force responseMimeType="application/json" on the same request
    // where tools are passed. Function calling in Gemini REST often fails to emit valid JSON 
    // conforming to the schema if forced into JSON mode while also outputting function calls.
    // Instead we remove the JSON mode requirements if it's the first iterations (tool calls)
    // OR we remove the tools on the final iteration to force JSON mode. 
    // The simplest robust approach for this is to let Gemini use its default text mode 
    // during the loop and use parseGeminiJsonText on the final output.
    const bodyWithSchema = {
      systemInstruction: {
        parts: [{ text: buildSystemInstruction() }],
      },
      contents: conversationHistory,
      tools: agenticToolsSchema,
      generationConfig: {
        temperature: 0.22,
        maxOutputTokens: 28672,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyWithSchema),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const fnCallPart = parts.find((p: any) => p.functionCall);

    if (!parts.length) {
      const block = data.promptFeedback?.blockReason;
      if (block) throw new Error(`Gemini blocked the request (${block}).`);
      const fr = cand?.finishReason || "unknown";
      throw new Error(`Gemini returned empty response (finish: ${fr}).`);
    }

    conversationHistory.push(cand.content);

    if (fnCallPart) {
      const fnName = fnCallPart.functionCall.name;
      const args = fnCallPart.functionCall.args || {};

      onLog(`🛠️ Tool Call: Executing **${fnName}**`);

      let resultData;
      try {
        if (fnName === "calculate_color_contrast") {
          resultData = calculate_color_contrast(args.fg_hex, args.bg_hex);
        } else if (fnName === "test_hyperlink_health") {
          resultData = await test_hyperlink_health(args.url);
        } else if (fnName === "simulate_focus_tabs") {
          resultData = await simulate_focus_tabs(activeTabId, args.count);
        } else if (fnName === "check_image_alt_texts") {
          resultData = await check_image_alt_texts(activeTabId);
        } else if (fnName === "analyze_heading_hierarchy") {
          resultData = await analyze_heading_hierarchy(activeTabId);
        } else {
          resultData = { error: "Unknown tool call" };
        }
      } catch (e) {
        resultData = { error: (e as Error).message };
      }

      onLog(`📥 Result: ${JSON.stringify(resultData)}`);

      conversationHistory.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: fnName,
              response: resultData,
            },
          },
        ],
      });
    } else {
      const generatedText = parts.map((p: any) => p.text || "").join("");
      
      // Try to parse it immediately to see if it's the final valid JSON
      try {
        parseGeminiJsonText(generatedText);
        // If it succeeds, we are truly done!
        isDone = true;
        finalRawText = generatedText;
        onLog("✅ Audit Complete! Generating final report.");
      } catch (e) {
        // If it's not valid JSON, it might be the agent just "talking" or giving an intermediate summary.
        // Or it messed up the formatting. We tell it to fix it!
        onLog("⚠️ Agent output was not valid JSON. Asking it to finalize the report...");
        conversationHistory.push({
          role: "user",
          parts: [{ text: "Your last response was either conversational text or invalid JSON. Please finish your analysis and output ONLY the final raw JSON object matching the schema, with no markdown fences, no conversational prose, and no explanation." }]
        });
      }
    }
  }

  if (!isDone) {
    throw new Error(`Agent reached maximum loop iterations (${MAX_LOOPS}) without returning a final JSON report.`);
  }

  let parsed: unknown;
  try {
    parsed = parseGeminiJsonText(finalRawText);
  } catch (e) {
    console.error("Agentic Parsing Error on string:", finalRawText);
    throw new Error("Failed to parse Gemini output as JSON: " + (e as Error).message);
  }

  return {
    parsed,
    notesExtra: `Agentic run finished. Nodes: ${nodeCount}. VLM images: ${imageStrips.length}`,
  };
}
