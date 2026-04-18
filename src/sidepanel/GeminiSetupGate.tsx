import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { sendMessage } from "./messaging";

type Props = {
  onSaved: () => void;
};

export function GeminiSetupGate({ onSaved }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okHint, setOkHint] = useState<string | null>(null);

  const testAndSave = async () => {
    const k = key.trim();
    if (!k) {
      setErr("Paste your Gemini API key first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setOkHint(null);
    try {
      const v = await sendMessage<{ ok: boolean; error?: string }>({
        type: "AUDIT_VALIDATE_GEMINI_KEY",
        key: k,
      });
      if (!v.ok) throw new Error(v.error || "Key rejected.");
      await sendMessage({ type: "AUDIT_SET_GEMINI_KEY", key: k });
      setOkHint("Saved.");
      setKey("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-300 dark:border-zinc-700">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          <KeyRound className="h-4 w-4" />
          Connect Google Gemini
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Get a free key from{" "}
          <a
            className="font-medium text-zinc-800 underline dark:text-zinc-200"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>
          . You can change models anytime in Settings.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Input
          type="password"
          autoComplete="off"
          placeholder="Paste your API key here"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          type="button"
          className="flex w-full items-center justify-center gap-2"
          disabled={busy || !key.trim()}
          onClick={() => void testAndSave()}
        >
          {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
          Save key
        </Button>
        {err ? <p className="text-xs text-red-600 dark:text-red-400">{err}</p> : null}
        {okHint ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{okHint}</p> : null}
      </CardContent>
    </Card>
  );
}
