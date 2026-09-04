'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'build');
const outputFile = path.join(outputDir, 'icon.ico');
const rootIconFile = path.join(root, 'icon.ico');
const publicPngFile = path.join(root, 'public', 'favicon.png');
const sizes = [256, 128, 64, 48, 32, 24, 16];
const sampleScale = 4;

fs.mkdirSync(outputDir, { recursive: true });

const images = sizes.map(size => ({
  size,
  png: createPng(size)
}));

const headerSize = 6 + images.length * 16;
const totalSize = headerSize + images.reduce((sum, image) => sum + image.png.length, 0);
const ico = Buffer.alloc(totalSize);

ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(images.length, 4);

let imageOffset = headerSize;
for (let index = 0; index < images.length; index += 1) {
  const image = images[index];
  const entryOffset = 6 + index * 16;
  ico.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
  ico.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
  ico.writeUInt8(0, entryOffset + 2);
  ico.writeUInt8(0, entryOffset + 3);
  ico.writeUInt16LE(1, entryOffset + 4);
  ico.writeUInt16LE(32, entryOffset + 6);
  ico.writeUInt32LE(image.png.length, entryOffset + 8);
  ico.writeUInt32LE(imageOffset, entryOffset + 12);
  image.png.copy(ico, imageOffset);
  imageOffset += image.png.length;
}

fs.writeFileSync(outputFile, ico);
fs.writeFileSync(rootIconFile, ico);
fs.writeFileSync(publicPngFile, createPng(256));
console.log(`Generated ${outputFile}`);
console.log(`Generated ${rootIconFile}`);
console.log(`Generated ${publicPngFile}`);

function createPng(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = sampledIconPixel(x, y, size);
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }

  const scanline = size * 4 + 1;
  const raw = Buffer.alloc(scanline * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * scanline] = 0;
    rgba.copy(raw, y * scanline + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr(size)),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function sampledIconPixel(x, y, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const samples = sampleScale * sampleScale;

  for (let sy = 0; sy < sampleScale; sy += 1) {
    for (let sx = 0; sx < sampleScale; sx += 1) {
      const px = (x + (sx + 0.5) / sampleScale) * 256 / size;
      const py = (y + (sy + 0.5) / sampleScale) * 256 / size;
      const color = iconPixel(px, py);
      const alpha = color[3] / 255;
      r += color[0] * alpha;
      g += color[1] * alpha;
      b += color[2] * alpha;
      a += alpha;
    }
  }

  if (!a) return [0, 0, 0, 0];
  return [
    Math.round(r / a),
    Math.round(g / a),
    Math.round(b / a),
    Math.round((a / samples) * 255)
  ];
}

function ihdr(size) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(size, 0);
  data.writeUInt32BE(size, 4);
  data.writeUInt8(8, 8);
  data.writeUInt8(6, 9);
  data.writeUInt8(0, 10);
  data.writeUInt8(0, 11);
  data.writeUInt8(0, 12);
  return data;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function iconPixel(x, y) {
  let color = [0, 0, 0, 0];
  if (roundedRect(x, y, 2, 2, 252, 252, 54)) color = [244, 246, 241, 255];
  if (roundedRect(x, y, 29, 29, 198, 198, 44)) color = [238, 252, 247, 255];
  if (roundedBorder(x, y, 29, 29, 198, 198, 44, 8)) color = [143, 232, 210, 255];
  if (bezierStroke(x, y, [77, 64], [105, 52], [151, 54], [176, 73], 6.5)) color = [6, 214, 160, 184];
  if (pointInTriangle(x, y, 100, 72, 100, 184, 193, 128)) color = [6, 17, 15, 255];
  if (circle(x, y, 96, 128, 17.5)) color = [6, 214, 160, 255];
  if (circle(x, y, 96, 128, 7.2)) color = [238, 252, 247, 255];
  return color;
}

function roundedRect(x, y, left, top, width, height, radius) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return x >= left && x <= right && y >= top && y <= bottom && Math.hypot(x - cx, y - cy) <= radius;
}

function roundedBorder(x, y, left, top, width, height, radius, thickness) {
  return roundedRect(x, y, left, top, width, height, radius)
    && !roundedRect(x, y, left + thickness, top + thickness, width - thickness * 2, height - thickness * 2, radius - thickness);
}

function circle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) <= radius;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const area = 0.5 * (-by * cx + ay * (-bx + cx) + ax * (by - cy) + bx * cy);
  const s = 1 / (2 * area) * (ay * cx - ax * cy + (cy - ay) * px + (ax - cx) * py);
  const t = 1 / (2 * area) * (ax * by - ay * bx + (ay - by) * px + (bx - ax) * py);
  return s >= 0 && t >= 0 && (1 - s - t) >= 0;
}

function bezierStroke(x, y, p0, p1, p2, p3, radius) {
  for (let i = 0; i <= 34; i += 1) {
    const t = i / 34;
    const px = cubic(p0[0], p1[0], p2[0], p3[0], t);
    const py = cubic(p0[1], p1[1], p2[1], p3[1], t);
    if (Math.hypot(x - px, y - py) <= radius) return true;
  }
  return false;
}

function cubic(a, b, c, d, t) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}
