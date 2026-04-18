/**
 * Picks a likely female-presenting English voice for chrome.tts (names differ by OS).
 */
export function pickChromeTtsVoiceName(): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.tts.getVoices((voices) => {
        if (!voices?.length) {
          resolve(undefined);
          return;
        }
        const preferExact = [
          "Microsoft Zira - English (United States)",
          "Microsoft Jenny - English (United States)",
          "Microsoft Aria Online (Natural) - English (United States)",
          "Google UK English Female",
          "Samantha",
          "Karen",
          "Victoria",
          "Moira",
          "Fiona",
        ];
        for (const name of preferExact) {
          const hit = voices.find((v) => v.voiceName === name);
          if (hit) {
            resolve(hit.voiceName);
            return;
          }
        }
        const sub = voices.find((v) => {
          const lang = v.lang ?? "";
          const name = v.voiceName ?? "";
          return (
            /zira|jenny|aria|samantha|karen|victoria|moira|fiona|serena|female|woman/i.test(name) &&
            /en(-|_)?(US|GB|AU|IN)/i.test(lang)
          );
        });
        resolve(sub?.voiceName);
      });
    } catch {
      resolve(undefined);
    }
  });
}
