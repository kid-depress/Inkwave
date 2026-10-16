// Rasterize the existing SVG icon; no additional design or graphics dependency is required.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';
const svg = await readFile(new URL('../build/icon.svg', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--disable-gpu'] });
try {
  const page = await browser.newPage();
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 256]) {
    const data = await page.evaluate(async ({ svg, size }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    images.push({ size, data: Buffer.from(data, 'base64') });
  }
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  await writeFile(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...images.map((i) => i.data)]));
  await writeFile(new URL('../assets/icon.png', import.meta.url), images.at(-1).data);
  console.log('Created build/icon.ico and assets/icon.png');
} finally { await browser.close(); }
