/** Raw PCM s16le mono playback (Gemini TTS output is typically 24 kHz). */

let stopPlayback: (() => void) | null = null;

export function stopGeminiAudio() {
  stopPlayback?.();
  stopPlayback = null;
}

export function playPcmS16leBase64(base64: string, sampleRate = 24000): Promise<void> {
  stopGeminiAudio();

  const binary = atob(base64);
  const byteLength = binary.length & ~1;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const frameCount = byteLength / 2;

  const ctx = new AudioContext({ sampleRate });
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, byteLength);
  for (let i = 0; i < frameCount; i++) {
    channel[i] = view.getInt16(i * 2, true) / 32768;
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const cleanup = () => {
      if (finished) return;
      finished = true;
      stopPlayback = null;
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
      void ctx.close().catch(() => {
        /* ignore */
      });
    };

    stopPlayback = () => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      cleanup();
      resolve();
    };

    src.onended = () => {
      cleanup();
      resolve();
    };

    void (async () => {
      try {
        if (ctx.state === "suspended") await ctx.resume();
        src.start();
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}
