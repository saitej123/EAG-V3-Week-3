import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GEMINI_AUDIT_MODEL, DEFAULT_GEMINI_IMAGE_MODEL } from "../config/gemini";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { sendMessage } from "../sidepanel/messaging";

type LoadedSettings = {
  apiBaseUrl: string;
  apiKey: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiImageModel: string;
  geminiMockupsEnabled: boolean;
};

export default function OptionsApp() {
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_AUDIT_MODEL);
  const [geminiImageModel, setGeminiImageModel] = useState(DEFAULT_GEMINI_IMAGE_MODEL);
  const [geminiMockupsEnabled, setGeminiMockupsEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [keyCheck, setKeyCheck] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  const [keyError, setKeyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await sendMessage<{ ok?: boolean; settings?: LoadedSettings }>({
      type: "AUDIT_GET_SETTINGS",
    });
    if (res.settings) {
      setApiBaseUrl(res.settings.apiBaseUrl);
      setApiKey(res.settings.apiKey);
      setGeminiApiKey(res.settings.geminiApiKey);
      setGeminiModel(res.settings.geminiModel || DEFAULT_GEMINI_AUDIT_MODEL);
      setGeminiImageModel(res.settings.geminiImageModel || DEFAULT_GEMINI_IMAGE_MODEL);
      setGeminiMockupsEnabled(res.settings.geminiMockupsEnabled !== false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    await chrome.storage.local.set({
      auditApiBaseUrl: apiBaseUrl.trim(),
      auditApiKey: apiKey.trim(),
      geminiApiKey: geminiApiKey.trim(),
      auditGeminiModel: geminiModel.trim() || DEFAULT_GEMINI_AUDIT_MODEL,
      auditGeminiImageModel: geminiImageModel.trim() || DEFAULT_GEMINI_IMAGE_MODEL,
      auditGeminiMockupsEnabled: geminiMockupsEnabled,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testGeminiKey = async () => {
    const key = geminiApiKey.trim();
    if (!key) {
      setKeyError("Paste a Gemini API key first.");
      setKeyCheck("bad");
      return;
    }
    setKeyError(null);
    setKeyCheck("checking");
    const res = await sendMessage<{ ok: boolean; error?: string }>({
      type: "AUDIT_VALIDATE_GEMINI_KEY",
      key,
    });
    if (res.ok) {
      setKeyCheck("ok");
      setTimeout(() => setKeyCheck("idle"), 2500);
    } else {
      setKeyCheck("bad");
      setKeyError(res.error || "Key check failed.");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-8 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agentic FairFrame settings</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Gemini reads structure + your screenshot and returns <strong>technical</strong> recommendations. The image
            model can sketch mockups when the audit asks for them (extra API calls).
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="text-sm font-medium">Google Gemini</div>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              Keys from{" "}
              <a
                className="underline underline-offset-2"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Google AI Studio
              </a>
              . Analysis uses <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{DEFAULT_GEMINI_AUDIT_MODEL}</code>{" "}
              by default; mockups use{" "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-900">{DEFAULT_GEMINI_IMAGE_MODEL}</code> when
              enabled.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Gemini API key</span>
              <Input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Paste key from Google AI Studio"
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Analysis model id</span>
              <Input
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                placeholder={DEFAULT_GEMINI_AUDIT_MODEL}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Image / mockup model id</span>
              <Input
                value={geminiImageModel}
                onChange={(e) => setGeminiImageModel(e.target.value)}
                placeholder={DEFAULT_GEMINI_IMAGE_MODEL}
                autoComplete="off"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-zinc-300"
                checked={geminiMockupsEnabled}
                onChange={(e) => setGeminiMockupsEnabled(e.target.checked)}
              />
              <span>
                <span className="font-medium">Generate visual mockups when the audit requests them</span>
                <span className="mt-0.5 block text-zinc-500 dark:text-zinc-500">
                  Up to 2 images per run — uses the image model above (billable). Turn off to save cost/latency.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="text-xs" onClick={() => void testGeminiKey()}>
                Test key with Google
              </Button>
              {keyCheck === "checking" ? (
                <span className="text-xs text-zinc-500">Checking…</span>
              ) : keyCheck === "ok" ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">Key accepted.</span>
              ) : null}
            </div>
            {keyError ? <p className="text-xs text-red-600 dark:text-red-400">{keyError}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-sm font-medium">Your own review server (optional)</div>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              If this URL is <strong>not</strong> the default demo host, Agentic FairFrame uses <strong>only</strong> your
              server — no Gemini analysis or mockups from this extension.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Review service web address</span>
              <Input
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://api.my-gemini-audit.com"
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Bearer token (your server only)</span>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Leave blank unless your server requires it"
                autoComplete="off"
              />
            </label>
            <Button type="button" onClick={() => void save()}>
              Save all settings
            </Button>
            {saved ? <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
