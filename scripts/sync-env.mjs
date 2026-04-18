import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env");
const outPath = resolve(root, "public", "config.local.json");

if (!existsSync(envPath)) {
  if (existsSync(outPath)) unlinkSync(outPath);
  process.exit(0);
}

const raw = readFileSync(envPath, "utf8");
const keyMatch = raw.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)$/m);
const val = keyMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";

if (!val) {
  if (existsSync(outPath)) unlinkSync(outPath);
  process.exit(0);
}

writeFileSync(outPath, JSON.stringify({ geminiApiKey: val }, null, 0) + "\n", "utf8");
console.log("sync-env: wrote public/config.local.json from .env (gitignored)");
