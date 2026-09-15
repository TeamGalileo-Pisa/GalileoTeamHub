import { mkdir, writeFile } from "node:fs/promises";
import { dirname, fileURLToPath } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const SOURCE_WIDTH = 144;
const SOURCE_HEIGHT = 144;
const SOURCE_RGB_ZLIB_BASE64 = "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";
const source = inflateSync(Buffer.from(SOURCE_RGB_ZLIB_BASE64, "base64"));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function sampleBilinear(x, y) {
  const x0 = Math.max(0, Math.min(SOURCE_WIDTH - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(SOURCE_HEIGHT - 1, Math.floor(y)));
  const x1 = Math.min(SOURCE_WIDTH - 1, x0 + 1);
  const y1 = Math.min(SOURCE_HEIGHT - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const out = [0, 0, 0];

  for (let channel = 0; channel < 3; channel += 1) {
    const p00 = source[(y0 * SOURCE_WIDTH + x0) * 3 + channel];
    const p10 = source[(y0 * SOURCE_WIDTH + x1) * 3 + channel];
    const p01 = source[(y1 * SOURCE_WIDTH + x0) * 3 + channel];
    const p11 = source[(y1 * SOURCE_WIDTH + x1) * 3 + channel];
    const top = p00 * (1 - tx) + p10 * tx;
    const bottom = p01 * (1 - tx) + p11 * tx;
    out[channel] = Math.round(top * (1 - ty) + bottom * ty);
  }

  return out;
}

function renderIcon(size, insetRatio = 0) {
  const inset = Math.round(size * insetRatio);
  const artSize = size - inset * 2;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  const background = [5, 24, 56];

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 3 + 1);
    rows[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      let rgb = background;

      if (x >= inset && y >= inset && x < size - inset && y < size - inset) {
        const sx = ((x - inset + 0.5) / artSize) * SOURCE_WIDTH - 0.5;
        const sy = ((y - inset + 0.5) / artSize) * SOURCE_HEIGHT - 0.5;
        rgb = sampleBilinear(sx, sy);
      }

      rows[pixelOffset] = rgb[0];
      rows[pixelOffset + 1] = rgb[1];
      rows[pixelOffset + 2] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const targets = [
  ["apple-touch-icon.png", 180, 0],
  ["icons/galileohub-192.png", 192, 0],
  ["icons/galileohub-512.png", 512, 0],
  ["icons/galileohub-maskable-512.png", 512, 0.11],
];

for (const [relativePath, size, insetRatio] of targets) {
  const target = `${publicDir}${relativePath}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderIcon(size, insetRatio));
}

console.log("Generated GalileoHub PWA icons.");
