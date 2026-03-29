import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildBattleReportSvg } from "../src/utils/battleReportSvgTemplate.js";

const outputPath = process.argv[2] || "reports/battlecard/export-fixture.png";

const tinyAvatar =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#222"/><text x="50%" y="54%" text-anchor="middle" font-size="24" fill="#fff" font-family="Arial">A</text></svg>`,
  );
const tinyCrown =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><path d="M8 90 L24 24 L56 56 L88 24 L104 90 Z" fill="#D4AF37"/></svg>`,
  );

const input = {
  teamColors: { primary: "#D4AF37", secondary: "#8B0000" },
  stanceColor: "#D4AF37",
  battleTitle: "KING OF CLUTCH",
  battleSubtitle: "WARZONE RATING",
  displayName: "LeBron Fan #23",
  teamLineText: "LAKERS",
  regionText: "Taiwan · Taipei",
  locationLine: "Taiwan · Taipei · 專屬戰報",
  rankLineText: "專屬戰報",
  reasonLabels: ["4TH QUARTER FINISH", "BASKETBALL IQ", "LEADERSHIP"],
  stanceDisplayName: "GOAT",
  wallText: "LAL",
  metaFooterLine: "1711111111111 VERIFIED DATA",
  disclaimerLine: "For fan entertainment only",
  evidenceLabel: "VERDICT EVIDENCE",
  brandLine: "The GOAT Meter",
  isTitleUppercase: true,
};

const assets = {
  avatarDataUri: tinyAvatar,
  crownDataUri: tinyCrown,
};

const svg = buildBattleReportSvg(input, assets);
const target = path.resolve(outputPath);
await fs.mkdir(path.dirname(target), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(target);
console.log(`[battlecard-fixture] generated: ${target}`);
