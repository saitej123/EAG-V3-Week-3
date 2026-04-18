import type { ChatMessage, PageSnapshot } from "../types/messages";

const MAX_INLINE_HTML_IMAGES = 16;

function buildSystemInstruction(snapshot: PageSnapshot): string {
  const mediaLines = snapshot.media
    .map(
      (m) =>
        `- [${m.tag}] ${m.title}: ${m.description || "no extra description"} — src hint: ${m.src || "n/a"}`,
    )
    .join("\n");

  const imgLines = snapshot.images
    .map((im, i) => `Image ${i + 1}: alt="${im.alt}" src="${im.src}"`)
    .join("\n");

  const scrollNote =
    snapshot.captureMeta?.scrollExpanded === true
      ? `Before capture, the page was auto-scrolled for up to ~${Math.round((snapshot.captureMeta.scrollUsedMs || 0) / 1000)}s to load lazy content; text reflects the DOM after that pass.`
      : "No auto-scroll pass was used for this capture (or it was disabled in config).";

  const viewportNote = snapshot.viewportScreenshotJpeg
    ? "A viewport screenshot (exactly what the user sees on screen) is attached as the first image in the bootstrap turn—use it for layout, feeds, and visible UI."
    : "No viewport screenshot was available for this capture—rely on text and inline images.";

  return `You are an expert, friendly tutor helping the user understand the web page they are on.

Voice & tone (many replies are read aloud):
- Default brevity: about 90–160 words unless the user clearly asks for depth, lists, or a full walkthrough.
- Sound engaging: one vivid hook or metaphor early, then concrete help—never a boring wall of text or three restatements of the same idea.
- Skip filler, corporate buzzwords, and robotic disclaimers.
- If the page is huge, give one crisp “you are here” summary first; invite them to ask to zoom into a section.

Rules:
- Explain ideas clearly; do NOT simply read the page aloud like a screen reader.
- Assume the user may not scroll the full page: proactively outline structure, key sections, and takeaways.
- When images are provided visually (viewport and/or inline), describe what you see and tie it to the page text.
- For video/audio/iframe elements you only have metadata (titles, URLs, labels)—say what is likely there and what the user should listen or look for; never invent transcripts you did not receive.
- If page text was truncated, say so briefly and offer to focus on a topic if they ask.
- Answer follow-ups like a tutor: short examples, one optional “want more?” invite—not a homework packet.

${viewportNote}

${scrollNote}
Note: Extremely aggressive “virtualized” lists may only keep visible rows in the DOM—those cannot be read until scrolled into view; we scroll automatically where possible.

Page title: ${snapshot.title}
URL: ${snapshot.url}
Text truncated in capture: ${snapshot.textTruncated}

Image registry (for reference; some may be attached as visuals):
${imgLines || "(none listed)"}

Media / embed hints:
${mediaLines || "(none listed)"}

--- PAGE TEXT ---
${snapshot.text}
--- END ---`;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export function buildUserPartsForHistory(
  messages: ChatMessage[],
): { role: string; parts: GeminiPart[] }[] {
  return messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
}

export async function tutorReply(params: {
  apiKey: string;
  model: string;
  snapshot: PageSnapshot;
  history: ChatMessage[];
}): Promise<string> {
  const { apiKey, model, snapshot, history } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const inlineFromPage: GeminiPart[] = snapshot.images
    .filter((im) => im.base64Jpeg)
    .slice(0, MAX_INLINE_HTML_IMAGES)
    .map((im) => ({
      inlineData: { mimeType: "image/jpeg", data: im.base64Jpeg! },
    }));

  const visualParts: GeminiPart[] = [];
  if (snapshot.viewportScreenshotJpeg) {
    visualParts.push({
      inlineData: { mimeType: "image/jpeg", data: snapshot.viewportScreenshotJpeg },
    });
  }
  visualParts.push(...inlineFromPage);

  const systemText = buildSystemInstruction(snapshot);

  const bootstrap: { role: string; parts: GeminiPart[] }[] = [
    {
      role: "user",
      parts: [
        {
          text:
            "Multimodal tutoring context: If the first image is present, it is a JPEG of the **browser viewport** (exactly what the user sees right now). Any following images are **same-origin inline** images from the HTML. Combine them with the system text for feeds, dashboards, and long pages.",
        },
        ...visualParts,
      ],
    },
    {
      role: "model",
      parts: [
        {
          text:
            "Ready. I will use the viewport, inline images, and page text together—like a tutor who can see the screen—to explain structure and meaning without dry verbatim reading unless you ask for quotes.",
        },
      ],
    },
  ];

  const contents: { role: string; parts: GeminiPart[] }[] = [
    ...bootstrap,
    ...buildUserPartsForHistory(history),
  ];

  const body = {
    systemInstruction: {
      parts: [{ text: systemText }],
    },
    contents,
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 1536,
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
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };

  if (data.error?.message) throw new Error(data.error.message);

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) throw new Error("Empty response from model.");
  return text;
}
