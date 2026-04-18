import { stopGeminiAudio } from "./audioPcm";

/** Incremented on every hard stop so stale TTS callbacks cannot flip UI state. */
let speechGeneration = 0;

export function getSpeechGeneration(): number {
  return speechGeneration;
}

/** Stop PCM, Chrome TTS, and speechSynthesis; invalidate in-flight playback callbacks. */
export function stopAllSpeechPlayback(): void {
  speechGeneration += 1;
  stopGeminiAudio();
  try {
    chrome.tts.stop();
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function speakChromeTts(
  text: string,
  preferredVoice: string | undefined,
  generationAtStart: number,
  onEnd?: () => void,
): void {
  const finish = () => {
    if (generationAtStart !== speechGeneration) return;
    onEnd?.();
  };

  const opts: { lang: string; rate: number; pitch: number; voiceName?: string } = {
    lang: "en-US",
    rate: 1.0,
    pitch: 1.05,
  };
  if (preferredVoice) opts.voiceName = preferredVoice;

  try {
    chrome.tts.speak(text, opts, () => {
      if (generationAtStart !== speechGeneration) return;
      if (chrome.runtime.lastError) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 1;
        u.pitch = 1.08;
        if (typeof window !== "undefined" && window.speechSynthesis) {
          const voices = window.speechSynthesis.getVoices();
          const needle = (preferredVoice || "").toLowerCase();
          const match =
            voices.find((v) => v.name === preferredVoice) ||
            (needle
              ? voices.find(
                  (v) =>
                    v.name.toLowerCase().includes(needle) ||
                    needle.includes(v.name.toLowerCase().slice(0, 12)),
                )
              : voices.find((v) => /zira|jenny|samantha|karen|female|woman/i.test(v.name)));
          if (match) u.voice = match;
        }
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        return;
      }
      finish();
    });
  } catch {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.pitch = 1.08;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  }
}
