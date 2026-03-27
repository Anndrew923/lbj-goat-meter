import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBattleReportSvg } from "../src/utils/battleReportSvgTemplate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "tmp", "battle-presets");

function svgDataUri(svgText) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

async function pngToDataUri(pngPath) {
  const buffer = await fs.readFile(pngPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

const avatarFallback = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#4e4e56"/>
  <circle cx="128" cy="104" r="52" fill="rgba(0,0,0,0.30)"/>
  <ellipse cx="128" cy="214" rx="86" ry="62" fill="rgba(0,0,0,0.34)"/>
</svg>`);

const sampleInput = {
  teamColors: { primary: "#552583", secondary: "#FDB927" },
  stanceColor: "#F7C948",
  battleTitle: "THE KING STILL OWNS THE FOURTH QUARTER",
  battleSubtitle: "ARENA FINAL VERDICT",
  displayName: "LeBron Witness",
  teamLineText: "LAKERS NATION",
  regionText: "USA · LOS ANGELES",
  rankLineText: "RANK: HALL OF FLAME",
  reasonLabels: [
    "Clutch Shot Selection",
    "Transition Defense Recovery",
    "On-Court Leadership",
    "Late Game IQ",
  ],
  stanceDisplayName: "GOAT MODE",
  wallText: "GOAT",
  metaFooterLine: "2026-03-27 23:59 UTC | VERIFIED DATA",
  disclaimerLine: "FOR FAN ENTERTAINMENT PURPOSES",
  evidenceLabel: "VERDICT EVIDENCE",
  brandLine: "GOAT METER",
  isTitleUppercase: true,
};

const presets = [
  { key: "standard", output: "preset-a-standard.svg" },
  { key: "warzone", output: "preset-b-warzone-target.svg" },
  { key: "overdrive", output: "preset-c-overdrive.svg" },
];

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const crownDataUri = await pngToDataUri(path.join(root, "src", "assets", "goat-crown-icon.png"));

  for (const preset of presets) {
    const svg = buildBattleReportSvg(
      {
        ...sampleInput,
        visualPreset: preset.key,
      },
      {
        avatarDataUri: avatarFallback,
        crownDataUri,
      },
    );
    const outPath = path.join(outputDir, preset.output);
    await fs.writeFile(outPath, svg, "utf8");
  }
  console.log(`rendered presets in: ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
