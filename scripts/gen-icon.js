'use strict';

// Generates build/icon.png — a 512×512 traffic-light app icon — with zero
// dependencies (hand-rolled PNG encoder). Run once: node scripts/gen-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const px = Buffer.alloc(S * S * 4, 0);

const clamp01 = v => Math.max(0, Math.min(1, v));

// signed-distance coverage with ~1.5px anti-aliasing
const coverage = d => clamp01(0.75 - d / 1.5);

function roundedRectSDF(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const circleSDF = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

function blend(x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * S + x) * 4;
  const ia = px[i + 3] / 255;
  const outA = a + ia * (1 - a);
  if (outA <= 0) return;
  px[i] = Math.round((r * a + px[i] * ia * (1 - a)) / outA);
  px[i + 1] = Math.round((g * a + px[i + 1] * ia * (1 - a)) / outA);
  px[i + 2] = Math.round((b * a + px[i + 2] * ia * (1 - a)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

const BG = [0x1f, 0x27, 0x33];
const RIM = [0x11, 0x16, 0x1e];
const LIGHTS = [
  { cy: 128, color: [0xe5, 0x48, 0x4d] }, // red
  { cy: 256, color: [0xf0, 0xa0, 0x0c] }, // amber
  { cy: 384, color: [0x2f, 0x9e, 0x44] }, // green
];
const R = 66;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // body with a slightly darker rim
    const body = roundedRectSDF(x, y, S / 2, S / 2, S / 2 - 8, S / 2 - 8, 104);
    blend(x, y, RIM, coverage(body));
    const inner = roundedRectSDF(x, y, S / 2, S / 2, S / 2 - 26, S / 2 - 26, 92);
    blend(x, y, BG, coverage(inner) * 0.98);
    // traffic lights + a soft halo ring
    for (const { cy, color } of LIGHTS) {
      blend(x, y, color, coverage(circleSDF(x, y, S / 2, cy, R)));
      blend(x, y, color, coverage(circleSDF(x, y, S / 2, cy, R + 9)) * 0.28);
    }
  }
}

// ---- PNG encode (color type 6, per-row filter 0) --------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
