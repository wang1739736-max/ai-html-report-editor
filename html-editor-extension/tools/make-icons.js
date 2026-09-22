// 生成插件图标：圆角渐变方块 + 白色 H（HTML 画板）
// 用法：node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const C1 = [0x6b, 0x8b, 0xff];   // 靛蓝
const C2 = [0x9b, 0x6b, 0xf7];   // 紫罗兰
const GOLD1 = [0xff, 0xe3, 0x9b];
const GOLD2 = [0xff, 0xb3, 0x47];

function inRoundedRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r + 1e-9;
}
// 点到线段的距离（用于画尖括号笔画）
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
// 点睛 LOGO：渐变圆角方块 + 白色尖括号 + 金色圆点（点睛之笔）
const STROKE = 0.043;            // 尖括号半笔宽
const CHEV_L = [[0.383, 0.293], [0.203, 0.5], [0.383, 0.707]];
const CHEV_R = [[0.617, 0.293], [0.797, 0.5], [0.617, 0.707]];
function inChevron(u, v, pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSeg(u, v, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= STROKE) return true;
  }
  return false;
}
function makeIcon(size) {
  const SS = 4;                       // 每像素 4×4 超采样，边缘更平滑
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!inRoundedRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.23)) continue;
          const dist = Math.hypot(u - 0.5, v - 0.5);
          let pr, pg, pb;
          if (dist <= 0.094) {                     // 点睛之点
            const t = (v - 0.41) / 0.19;
            pr = lerp(GOLD1[0], GOLD2[0], Math.max(0, Math.min(1, t)));
            pg = lerp(GOLD1[1], GOLD2[1], Math.max(0, Math.min(1, t)));
            pb = lerp(GOLD1[2], GOLD2[2], Math.max(0, Math.min(1, t)));
          } else if (dist <= 0.113) {              // 白色描边
            pr = pg = pb = 255;
          } else if (inChevron(u, v, CHEV_L) || inChevron(u, v, CHEV_R)) {
            pr = pg = pb = 255;                    // 尖括号
          } else {
            const t = (u + v) / 2;                 // 渐变底
            pr = lerp(C1[0], C2[0], t);
            pg = lerp(C1[1], C2[1], t);
            pb = lerp(C1[2], C2[2], t);
          }
          r += pr; g += pg; b += pb; a += 255;
        }
      }
      const n = SS * SS;
      const idx = (y * size + x) * 4;
      const cov = a / (255 * n);
      if (cov <= 0) { rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = rgba[idx + 3] = 0; continue; }
      const cnt = a / 255;
      rgba[idx] = Math.round(r / cnt);
      rgba[idx + 1] = Math.round(g / cnt);
      rgba[idx + 2] = Math.round(b / cnt);
      rgba[idx + 3] = Math.round(cov * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach(size => {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log('生成', path.relative(path.join(__dirname, '..'), file), fs.statSync(file).size + 'B');
});
