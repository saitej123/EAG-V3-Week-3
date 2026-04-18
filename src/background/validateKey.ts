/** Lightweight check that the key is accepted by the Gemini API (no chat charge). */
export async function validateGeminiApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, message: "Add your Gemini API key first." };

  const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    if (res.ok) return { ok: true };

    const body = await res.text();
    if (res.status === 400 || res.status === 403) {
      return {
        ok: false,
        message:
          "That API key was rejected. Open Google AI Studio, create or copy a fresh key, and paste it again.",
      };
    }
    if (res.status === 429) {
      return { ok: false, message: "Google rate-limited the key check—wait a minute and try Begin again." };
    }
    return {
      ok: false,
      message: `Could not verify the key (HTTP ${res.status}). Check your network or try again later.`,
    };
  } catch {
    return { ok: false, message: "No network reach to Google. Check your connection, then try Begin again." };
  }
}
