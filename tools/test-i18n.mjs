// Language switching regression: real menus and HUD, with no WebGL/relay required.
// npm run test-i18n (set CHROME_PATH if Chrome is not in its usual location).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';
import { t, setLanguage, normalizeLanguage } from '../src/ui/i18n.js';

assert.equal(normalizeLanguage('invalid'), 'en');
assert.equal(setLanguage('zh-CN'), 'zh-CN');
assert.equal(t('SETTINGS'), '设置');
assert.equal(t('  SETTINGS  '), '  设置  ');
assert.equal(t('90 SEC'), '90 秒');
assert.equal(t('Connecting to room BCE23…'), '正在连接房间 BCE23……');
assert.equal(t('Waiting for SETTINGS & READY'), '正在等待 SETTINGS & READY');
assert.equal(t('Unknown copy'), 'Unknown copy');
assert.equal(t('constructor'), 'constructor');
assert.equal(setLanguage('en'), 'en');
assert.equal(t('SETTINGS'), 'SETTINGS');

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + pathname);
    if (relative(root, file).startsWith('..')) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/ui-lab.html?screen=settings&clean=1`, { waitUntil: 'networkidle0' });
  await page.click('[data-id="tab-gameplay"]');
  await page.click('[data-id="set-language"] .iw-seg__opt:last-child');
  assert.equal(await page.evaluate(() => lab.S.settings.language), 'zh-CN');
  assert.equal(await page.$eval('html', (el) => el.lang), 'zh-CN');
  assert.equal(await page.$eval('.iw-head__title', (el) => el.textContent), '设置');
  assert.equal(await page.evaluate(() => lab.hudObj.mapLegend.querySelector('.iw-lg__title').textContent), '超级跳跃');

  // Copy split by keycaps translates as a sentence; player input is escaped and remains opaque.
  await page.evaluate(async () => {
    const { h, setText } = await import('/src/ui/ui-util.js');
    const { richText } = await import('/src/ui/ui-icons.js');
    window.copyProbe = h('div', { html: richText('Hold [SHIFT] to dive into your ink — you are nearly invisible while swimming.') });
    window.nameProbe = h('span', { translate: 'no' }, 'SETTINGS');
    window.escapeProbe = h('span', { text: '<img src=x onerror=alert(1)>' });
    window.dynamicProbe = h('span');
    setText(dynamicProbe, 'Saved!');
    window.attrProbe = h('div', { title: 'Default', html: '<svg viewBox="0 0 64 64"><path d="M1 2 L3 4"/></svg>' });
  });
  assert.match(await page.evaluate(() => copyProbe.textContent), /潜入己方墨水/);
  assert.equal(await page.evaluate(() => copyProbe.querySelector('kbd').textContent), 'SHIFT');
  assert.equal(await page.evaluate(() => nameProbe.textContent), 'SETTINGS');
  assert.equal(await page.evaluate(() => escapeProbe.children.length), 0);
  assert.equal(await page.evaluate(() => dynamicProbe.textContent), '已保存！');
  assert.equal(await page.evaluate(() => attrProbe.title), '默认');

  // Both keyboard directions work without rebuilding the settings screen or losing focus.
  await page.evaluate(() => lab.menus._setFocus(document.querySelector('[data-id="set-language"]')));
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => lab.S.settings.language), 'en');
  assert.equal(await page.$eval('.iw-head__title', (el) => el.textContent), 'SETTINGS');
  assert.match(await page.evaluate(() => copyProbe.textContent), /^Hold SHIFT to dive/);
  assert.equal(await page.evaluate(() => dynamicProbe.textContent), 'Saved!');
  assert.equal(await page.evaluate(() => attrProbe.title), 'Default');
  assert.equal(await page.evaluate(() => attrProbe.querySelector('svg').getAttribute('viewBox')), '0 0 64 64');
  assert.equal(await page.evaluate(() => attrProbe.querySelector('path').getAttribute('d')), 'M1 2 L3 4');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => lab.S.settings.language), 'zh-CN');
  assert.equal(await page.evaluate(() => nameProbe.textContent), 'SETTINGS');

  // Every settings tab, including its changing help/preview copy, renders without errors.
  for (const tab of ['controls', 'video', 'audio', 'gameplay']) {
    await page.click(`[data-id="tab-${tab}"]`);
    for (const row of await page.$$('[data-id^="set-"]')) await row.hover();
  }
  await page.click('[data-id="reset"]');
  await page.click('[data-id="reset"]');
  assert.equal(await page.evaluate(() => lab.S.settings.language), 'en');
  assert.equal(await page.$eval('html', (el) => el.lang), 'en');
  await page.click('[data-id="set-language"] .iw-seg__opt:last-child');
  await page.evaluate(() => { lab.S.profile.name = 'SETTINGS'; lab.go('main', { wipe: false }); });
  assert.equal(await page.$eval('.iw-profile__name', (el) => el.textContent), 'SETTINGS');
  assert.equal(await page.$eval('[data-id="play"] .iw-btn__label', (el) => el.textContent), '开始游戏');
  for (const screen of ['mode', 'setup', 'loadout', 'locker', 'howto', 'online', 'pause']) {
    await page.evaluate((name) => lab.go(name, { wipe: false }), screen);
  }
  assert.deepEqual(errors, []);
  console.log('i18n ok: translation fallback, live menus/HUD, keycaps, input safety, keyboard switching and reset');
} finally {
  await browser?.close();
  await new Promise((res) => server.close(res));
}
