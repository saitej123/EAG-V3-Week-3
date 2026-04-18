/**
 * Gemini native TTS (preview). See: https://ai.google.dev/gemini-api/docs/speech-generation
 * Returns raw PCM s16le mono at 24kHz as base64 (same as API inlineData).
 */
export async function synthesizeGeminiTts(params: {
  apiKey: string;
  model: string;
  voiceName: string;
  text: string;
}): Promise<string> {
  const { apiKey, model, voiceName, text } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: `Speak the following as a warm, clear guide helping someone understand a web page. One continuous delivery, no sound effects:\n\n${text}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini TTS ${res.status}: ${err.slice(0, 280)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    error?: { message?: string };
  };

  if (data.error?.message) throw new Error(data.error.message);

  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64)
    throw new Error("Gemini TTS returned no audio. Check ttsEngine / model / voice in fairframe.config.json.");

  return b64;
}
