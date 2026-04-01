export function drawSlantedRect(ctx, x, y, width, height, slantOffset = 0) {
  const slant = Math.max(0, Math.min(width * 0.2, slantOffset));
  ctx.beginPath();
  ctx.moveTo(x + slant, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width - slant, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();
}

export function drawGlowEffect(ctx, text, x, y, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 56;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 24;
  ctx.fillText(text, x, y);
  ctx.restore();
}
