import { CanvasTexture, SRGBColorSpace } from 'three';

const cache = new Map();

/**
 * Textura de texto dibujada en canvas (sin fuentes remotas: funciona offline en Docker).
 * Devuelve { texture, aspect } para dimensionar el plano que la muestra.
 */
export function labelTexture(text, {
  color = '#ffffff', bg = 'rgba(0,0,0,0)', font = '700 64px "Segoe UI", Roboto, Arial, sans-serif',
  pad = 24, border = null,
} = {}) {
  const key = [text, color, bg, font, pad, border].join('|');
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const lines = String(text).split('\n');
  const size = parseInt(font.match(/(\d+)px/)?.[1] ?? 64, 10);
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
  const h = Math.ceil(size * 1.25 * lines.length) + pad * 2;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6); }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, pad + size * 1.25 * (i + 0.5)));
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const out = { texture, aspect: w / h };
  cache.set(key, out);
  return out;
}
