// Real browser pointer lock after a refused automatic network-start request.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';
import { startGameServer } from '../electron/local-server.cjs';

const host = await startGameServer({ root: fileURLToPath(new URL('../', import.meta.url)), port: 0 });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true,
    args: ['--no-proxy-server', '--disable-gpu', '--no-first-run'] });
  console.log('Pointer-lock test browser launched');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url() === host.url + '/input-test') request.respond({ status: 200, contentType: 'text/html', body: '<html><head></head><body></body></html>' });
    else request.continue();
  });
  await page.goto(host.url + '/input-test');
  await page.setContent(`<link rel="stylesheet" href="/styles/ui.css">
    <canvas width="800" height="500"></canvas><div id="ui-root"></div>
    <script type="module">
      import { Input } from '/src/core/input.js';
      import { PointerCapture } from '/src/ui/pointer-capture.js';
      import { setLanguage } from '/src/ui/i18n.js';
      window.input = new Input(document.querySelector('canvas'));
      window.active = true;
      window.capture = new PointerCapture(input, document.querySelector('#ui-root'), () => active);
      window.setLanguage = setLanguage;
      capture.update();
    </script>`);
  await page.waitForFunction(() => window.capture);
  console.log('Input and capture prompt mounted');
  await page.evaluate(async () => {
    const canvas = input.canvas, real = canvas.requestPointerLock;
    // Both forms of unsupported raw input must retry without the option.
    for (const synchronous of [true, false]) {
      const calls = [];
      canvas.requestPointerLock = (options) => {
        calls.push(options);
        if (options) {
          const error = new DOMException('Raw input unavailable', 'NotSupportedError');
          if (synchronous) throw error;
          return Promise.reject(error);
        }
      };
      await input.requestLock();
      if (calls.length !== 2 || calls[1] !== undefined) throw new Error('Plain pointer-lock fallback missing');
    }
    // Reproduce the guest's denied automatic request after an async network start.
    canvas.requestPointerLock = () => Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
    await input.requestLock();
    canvas.requestPointerLock = real;
    setLanguage('zh-CN'); capture.update();
  });
  assert.equal(await page.$eval('.iw-pointer-capture', (el) => el.hidden), false);
  assert.match(await page.$eval('.iw-pointer-capture', (el) => el.textContent), /点击进入瞄准/);
  await page.click('.iw-pointer-capture');
  await page.waitForFunction(() => input.locked && capture.el.hidden);
  console.log('Real pointer lock acquired after click');
  assert.equal(await page.evaluate(() => input.mouse.left || input.mouse.leftPressed), false, 'Capture click must not fire');
  await page.evaluate(() => input.endFrame());
  await page.mouse.move(470, 330);
  assert.ok(await page.evaluate(() => Math.abs(input.mouse.dx) + Math.abs(input.mouse.dy) > 0), 'Locked mouse must deliver aim deltas');
  await page.evaluate(() => { input.exitLock(); active = false; });
  await page.waitForFunction(() => !input.locked);
  await page.evaluate(() => capture.update());
  assert.equal(await page.$eval('.iw-pointer-capture', (el) => el.hidden), true, 'No prompt over pause/lobby');
  await page.evaluate(() => { active = true; input.setTouchMode(true); capture.update(); });
  assert.equal(await page.$eval('.iw-pointer-capture', (el) => el.hidden), true);
  await page.evaluate(() => { input.setTouchMode(false); input.pad = {}; input.lastDevice = 'pad'; capture.update(); });
  assert.equal(await page.$eval('.iw-pointer-capture', (el) => el.hidden), true);
  await page.evaluate(() => { input.pad = null; capture.update(); });
  // Clicking the canvas is another recovery path even without targeting the prompt.
  await page.mouse.click(50, 50);
  await page.waitForFunction(() => input.locked);
  assert.deepEqual(errors, []);
  console.log('pointer capture ok: rejected network start, trusted click recovery, real mouse deltas, raw-input fallback, touch/pad/menu guards');
} finally {
  await browser?.close();
  host.server.closeAllConnections();
  await new Promise((resolve) => host.server.close(resolve));
}
