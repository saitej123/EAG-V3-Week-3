/**
 * Rasterize public/icons/icon-source.svg → icon16.png, icon48.png, icon128.png
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "public", "icons", "icon-source.svg");
const outDir = join(root, "public", "icons");

const svg = await readFile(svgPath);

for (const size of [16, 48, 128]) {
  const dest = join(outDir, `icon${size}.png`);
  await sharp(svg, { density: size <= 16 ? 600 : 320 })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(dest);
  console.log("wrote", dest);
}
