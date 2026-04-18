/**
 * Optional UI mockups via Gemini native image output.
 * REST: generationConfig.responseModalities — https://ai.google.dev/api/generate-content
 */
type GenPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

function firstGeneratedImage(data: unknown): { base64: string; mime: string; caption: string } | null {
  const root = data as { candidates?: { content?: { parts?: GenPart[] } }[] };
  const parts = root.candidates?.[0]?.content?.parts || [];
  let caption = "";
  for (const p of parts) {
    if (typeof p.text === "string") caption += p.text;
    const inline = p.inlineData || p.inline_data;
    if (!inline?.data) continue;
    const mime = (
      p.inlineData?.mimeType ||
      p.inline_data?.mime_type ||
      "image/png"
    ).toLowerCase();
    if (mime.startsWith("image/")) {
      return { base64: inline.data, mime, caption: caption.trim() };
    }
  }
  return null;
}

async function postImageRequest(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; errText?: string; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const status = res.status;
  const text = await res.text();
  if (!res.ok) return { ok: false, errText: text, status };
  if (!text.trim()) return { ok: false, errText: "Empty response body", status };
  try {
    return { ok: true, data: JSON.parse(text), status };
  } catch {
    return { ok: false, errText: text.slice(0, 200), status };
  }
}

function shouldRetryWithMinimalBody(result: { ok: boolean; status: number; errText?: string }): boolean {
  if (result.ok) return false;
  if (result.status === 400) return true;
  const t = (result.errText || "").toLowerCase();
  return t.includes("invalid") || t.includes("unknown") || t.includes("imageconfig");
}

/**
 * Generate one annotated wireframe / mockup. Uses viewport JPEG as visual reference when provided.
 */
export async function generateAuditMockupImage(params: {
  apiKey: string;
  model: string;
  viewportJpegBase64: string | null;
  issueContext: string;
  generationPrompt: string;
}): Promise<{ imageBase64: string | null; mime: string; caption: string }> {
  const { apiKey, model, viewportJpegBase64, issueContext, generationPrompt } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const instruction = `You are a senior product designer generating a SINGLE reference image for a web team.

Context (issue on a real page):
${issueContext.slice(0, 4000)}

Art direction for this image:
${generationPrompt.slice(0, 4000)}

Requirements:
- Output a clear UI/UX mockup or annotated wireframe (not a photo of people).
- Use neutral UI chrome; focus on layout, spacing, labels, contrast, tap targets, or hierarchy as relevant.
- Add short on-image labels or callouts if helpful.
- Keep it professional and appropriate for a workplace design review.`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (viewportJpegBase64) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: viewportJpegBase64 },
    });
  }
  parts.push({ text: instruction });

  const fullBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 8192,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "1K",
      },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const minimalBody = {
    ...fullBody,
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 8192,
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  let result = await postImageRequest(url, fullBody);
  if (shouldRetryWithMinimalBody(result)) {
    result = await postImageRequest(url, minimalBody);
  }
  if (!result.ok) {
    throw new Error(result.errText?.slice(0, 500) || "Image generation request failed.");
  }

  const img = firstGeneratedImage(result.data);
  if (!img) {
    return { imageBase64: null, mime: "image/png", caption: "" };
  }

  return {
    imageBase64: img.base64,
    mime: img.mime,
    caption: img.caption || "Generated mockup.",
  };
}
