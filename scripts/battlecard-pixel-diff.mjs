import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const imageA = arg("--a");
const imageB = arg("--b");
const outJson = arg("--out-json", "reports/battlecard/pixel-diff-report.json");
const outPng = arg("--out-png", "reports/battlecard/pixel-diff-heatmap.png");
const threshold = Number(arg("--threshold", "24"));

if (!imageA || !imageB) {
  console.error("Usage: node scripts/battlecard-pixel-diff.mjs --a <imageA.png> --b <imageB.png> [--out-json <path>] [--out-png <path>] [--threshold <0-255>]");
  process.exit(1);
}

const [aMeta, bMeta] = await Promise.all([sharp(imageA).metadata(), sharp(imageB).metadata()]);
if (aMeta.width !== bMeta.width || aMeta.height !== bMeta.height) {
  console.error(`[pixel-diff] size mismatch: A=${aMeta.width}x${aMeta.height}, B=${bMeta.width}x${bMeta.height}`);
  process.exit(2);
}

const [aRaw, bRaw] = await Promise.all([
  sharp(imageA).ensureAlpha().raw().toBuffer(),
  sharp(imageB).ensureAlpha().raw().toBuffer(),
]);

const width = aMeta.width;
const height = aMeta.height;
const channels = 4;
const totalPixels = width * height;
const diffRaw = Buffer.alloc(aRaw.length);

let diffPixels = 0;
let totalDelta = 0;
let maxDelta = 0;

for (let i = 0; i < aRaw.length; i += channels) {
  const dr = Math.abs(aRaw[i] - bRaw[i]);
  const dg = Math.abs(aRaw[i + 1] - bRaw[i + 1]);
  const db = Math.abs(aRaw[i + 2] - bRaw[i + 2]);
  const da = Math.abs(aRaw[i + 3] - bRaw[i + 3]);
  const delta = Math.max(dr, dg, db, da);
  totalDelta += delta;
  if (delta > maxDelta) maxDelta = delta;
  if (delta > threshold) diffPixels += 1;

  // heatmap: red intensity by delta
  diffRaw[i] = delta;
  diffRaw[i + 1] = Math.floor(delta * 0.15);
  diffRaw[i + 2] = 0;
  diffRaw[i + 3] = 255;
}

const mismatchRatio = diffPixels / totalPixels;
const avgDelta = totalDelta / totalPixels;

const jsonReport = {
  imageA: path.resolve(imageA),
  imageB: path.resolve(imageB),
  width,
  height,
  threshold,
  diffPixels,
  totalPixels,
  mismatchRatio,
  mismatchPercent: Number((mismatchRatio * 100).toFixed(4)),
  avgDelta: Number(avgDelta.toFixed(4)),
  maxDelta,
  generatedAt: new Date().toISOString(),
};

await fs.mkdir(path.dirname(path.resolve(outJson)), { recursive: true });
await fs.mkdir(path.dirname(path.resolve(outPng)), { recursive: true });
await fs.writeFile(path.resolve(outJson), `${JSON.stringify(jsonReport, null, 2)}\n`, "utf8");
await sharp(diffRaw, { raw: { width, height, channels } }).png().toFile(path.resolve(outPng));

console.log(`[pixel-diff] report: ${path.resolve(outJson)}`);
console.log(`[pixel-diff] heatmap: ${path.resolve(outPng)}`);
console.log(`[pixel-diff] mismatch: ${jsonReport.mismatchPercent}%`);
