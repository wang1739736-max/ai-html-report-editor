// 导出品牌用的大尺寸 PNG（512 / 1024），复用插件图标的绘制逻辑
const fs = require('fs');
const path = require('path');

// 复用 make-icons.js 里的绘制函数：这里用最小重写，避免副作用（它会在末尾自动生成 icons）
const zlib = require('zlib');
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, c]); }
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const lerp = (a, b, t) => a + (b - a) * t;
const C1 = [0x6b, 0x8b, 0xff], C2 = [0x9b, 0x6b, 0xf7], G1 = [0xff, 0xe3, 0x9b], G2 = [0xff, 0xb3, 0x47];
const inRR = (u, v, x0, y0, x1, y1, r) => { if (u < x0 || u > x1 || v < y0 || v > y1) return false; const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r); const dx = u - cx, dy = v - cy; return dx * dx + dy * dy <= r * r + 1e-9; };
function dSeg(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); }
const S = 0.043, L = [[0.383, 0.293], [0.203, 0.5], [0.383, 0.707]], R = [[0.617, 0.293], [0.797, 0.5], [0.617, 0.707]];
const inChev = (u, v, p) => p.some((_, i) => i < p.length - 1 && dSeg(u, v, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= S);

function render(size, transparentBg) {
  const SS = 2, rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
      const inside = transparentBg ? true : inRR(u, v, 0.015, 0.015, 0.985, 0.985, 0.23);
      if (!inside) continue;
      const d = Math.hypot(u - 0.5, v - 0.5);
      let pr, pg, pb;
      if (d <= 0.094) { const t = Math.max(0, Math.min(1, (v - 0.41) / 0.19)); pr = lerp(G1[0], G2[0], t); pg = lerp(G1[1], G2[1], t); pb = lerp(G1[2], G2[2], t); }
      else if (d <= 0.113) { pr = pg = pb = 255; }
      else if (inChev(u, v, L) || inChev(u, v, R)) { pr = pg = pb = 255; }
      else { const t = (u + v) / 2; pr = lerp(C1[0], C2[0], t); pg = lerp(C1[1], C2[1], t); pb = lerp(C1[2], C2[2], t); }
      r += pr; g += pg; b += pb; a += 255;
    }
    const n = SS * SS, i = (y * size + x) * 4, cov = a / (255 * n), cnt = a / 255;
    if (cov <= 0) { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; continue; }
    rgba[i] = Math.round(r / cnt); rgba[i + 1] = Math.round(g / cnt); rgba[i + 2] = Math.round(b / cnt); rgba[i + 3] = Math.round(cov * 255);
  }
  return encodePNG(size, size, rgba);
}

const out = path.resolve(__dirname, '..', 'brand');
fs.mkdirSync(out, { recursive: true });
[[512, 'logo-mark-512.png'], [1024, 'logo-mark-1024.png']].forEach(([s, name]) => {
  fs.writeFileSync(path.join(out, name), render(s, false));
  console.log('生成 brand/' + name);
});
