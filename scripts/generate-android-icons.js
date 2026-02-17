/**
 * 從 1024x1024 圖檔產生 Android Adaptive Icon 所需之 mipmap 與 drawable
 * 使用方式: node scripts/generate-android-icons.js
 */
const fs = require('fs');
const path = require('path');

const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE = path.join(ROOT, 'assets', 'icon-1024.png');

// Adaptive Icon foreground 層為 108dp，對應像素：mdpi=108, hdpi=162, xhdpi=216, xxhdpi=324, xxxhdpi=432
const FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

// Legacy launcher icon 尺寸 (dp 對應 px)
const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function generate() {
  if (!fs.existsSync(SOURCE)) {
    console.error('找不到來源圖檔: ' + SOURCE);
    process.exit(1);
  }

  const buffer = await sharp(SOURCE).ensureAlpha().png().toBuffer();

  for (const [folder, size] of Object.entries(FOREGROUND_SIZES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    await sharp(buffer)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, 'ic_launcher_foreground.png'));
    console.log('寫入 ' + folder + '/ic_launcher_foreground.png (' + size + 'px)');
  }

  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    const p = path.join(outDir, 'ic_launcher.png');
    const r = path.join(outDir, 'ic_launcher_round.png');
    await sharp(buffer).resize(size, size).png().toFile(p);
    await sharp(buffer).resize(size, size).png().toFile(r);
    console.log('寫入 ' + folder + '/ic_launcher.png, ic_launcher_round.png (' + size + 'px)');
  }

  const drawableNodpi = path.join(ANDROID_RES, 'drawable-nodpi');
  await ensureDir(drawableNodpi);
  await sharp(buffer)
    .resize(432, 432)
    .png()
    .toFile(path.join(drawableNodpi, 'ic_launcher_foreground.png'));
  console.log('寫入 drawable-nodpi/ic_launcher_foreground.png (432px)');

  console.log('圖標產生完成。');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
