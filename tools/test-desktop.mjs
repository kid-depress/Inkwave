// Exercise the actual packaged binary. The window stays hidden and uses a disposable user profile.
// npm run test-desktop -- [path/to/INKWAVE.exe] [--network]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';
import { chromePath } from './chrome.mjs';

const args = process.argv.slice(2);
const config = JSON.parse(await readFile(new URL('../electron/config.json', import.meta.url), 'utf8'));
const exe = path.resolve(args.find((arg) => !arg.startsWith('--')) || 'dist/INKWAVE-win32-x64/INKWAVE.exe');
const profile = await mkdtemp(path.join(tmpdir(), 'inkwave-desktop-test-'));
let child, browser, guestBrowser;
let logs = '';
try {
  child = spawn(exe, ['--inkwave-smoke', `--inkwave-user-data=${profile}`, '--remote-debugging-port=0',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required',
    ...(args.includes('--direct') ? ['--no-proxy-server'] : [])], { windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron did not expose its test endpoint: ' + logs.slice(-1500))), 30000);
    const collect = (chunk) => {
      logs += chunk.toString();
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stderr.on('data', collect); child.stdout.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Electron exited (${code}): ${logs.slice(-2000)}`)); });
  });
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  const target = await browser.waitForTarget((item) => item.type() === 'page' && /127\.0\.0\.1.*index\.html/.test(item.url()), { timeout: 30000 });
  const page = await target.page();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  console.log('Packaged window loaded; compiling game shaders…');
  await page.waitForFunction(() => window.__inkwave?.menus?.current === 'title', { timeout: 180000 });
  const initial = await page.evaluate(async () => ({
    lang: document.documentElement.lang, relay: (await import('./src/net/transport.js')).relayURL(),
    platform: window.inkwaveNative.platform, node: typeof window.require, origin: location.origin,
  }));
  assert.equal(initial.lang, 'zh-CN'); assert.equal(initial.platform, 'win32'); assert.equal(initial.node, 'undefined');
  assert.equal(initial.relay, config.relay);
  const response = await fetch(page.url());
  const connectPolicy = response.headers.get('content-security-policy').split(';').find((directive) => directive.trim().startsWith('connect-src'));
  assert.ok(connectPolicy.trim().split(/\s+/).includes(new URL(config.relay).origin));
  await page.evaluate(() => { __inkwave.menus.show('settings', { wipe: false }); __inkwave.menus._setSetting('language', 'en'); });
  assert.equal(await page.$eval('.iw-head__title', (el) => el.textContent), 'SETTINGS');
  await page.evaluate(() => __inkwave.menus._setSetting('language', 'zh-CN'));
  assert.equal(await page.$eval('.iw-head__title', (el) => el.textContent), '设置');
  console.log('Packaged UI ok: Simplified Chinese, native preload, isolated renderer, live language switching');
  if (args.includes('--network')) {
    const code = await page.evaluate(() => __G.net.create('Desktop test'));
    assert.match(code, /^[A-Z0-9]{5}$/);
    await page.evaluate(async (room) => {
      const { NetSession } = await import('./src/net/session.js');
      window.__packageGuestSession = new NetSession();
      await window.__packageGuestSession.join(room, 'PackageGuest');
    }, code);
    await page.waitForFunction(() => __G.net.lobby.players.length === 2 && window.__packageGuestSession.lobby.players.length === 2,
      { timeout: 15000, polling: 100 });
    await page.evaluate(() => window.__packageGuestSession.setMe({ ready: true }));
    await page.waitForFunction(() => {
      const view = (session) => JSON.stringify(session.lobby.players.map(({ id, name, team, ready }) => ({ id, name, team, ready })));
      return __G.net.canStart() && view(__G.net) === view(window.__packageGuestSession);
    }, { timeout: 15000, polling: 100 });
    await page.evaluate(() => { window.__packageGuestSession.leave(); __G.net.leave(); });
    console.log('Public relay ok: full guest session joined, lobby rosters agree and ready state reached the host');
  }
  if (args.includes('--match')) {
    guestBrowser = await puppeteer.launch({ executablePath: chromePath(), headless: true,
      args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
    const guest = await guestBrowser.newPage();
    guest.on('pageerror', (error) => errors.push(error.message));
    await guest.goto(`${initial.origin}/index.html?quality=low&relay=${encodeURIComponent(config.relay)}`);
    await guest.waitForFunction(() => window.__inkwave?.menus?.current === 'title', { timeout: 180000, polling: 100 });
    console.log('Independent guest loaded; starting a real online round…');
    const room = await page.evaluate(() => __G.net.create('AimHost'));
    await guest.evaluate((code) => __G.net.join(code, 'AimGuest'), room);
    await guest.evaluate(() => {
      // Deterministically reproduce a refused automatic lock on this guest.
      const canvas = __G.input.canvas, original = canvas.requestPointerLock;
      canvas.requestPointerLock = function () {
        this.requestPointerLock = original;
        return Promise.reject(new DOMException('User gesture required', 'NotAllowedError'));
      };
      __G.net.setMe({ ready: true });
    });
    await page.waitForFunction(() => __G.net.canStart(), { timeout: 15000, polling: 100 });
    await page.evaluate(() => __G.net.start());
    await guest.waitForFunction(() => __G.net.state === 'match' && __G.match?.state === 'playing', { timeout: 180000, polling: 100 });
    await guest.waitForSelector('.iw-pointer-capture:not([hidden])');
    assert.equal(await guest.evaluate(() => __G.input.locked), false);
    await guest.click('.iw-pointer-capture');
    await guest.waitForFunction(() => __G.input.locked && __inkwave.pointerCapture.el.hidden, { polling: 100 });
    const yaw = await guest.evaluate(() => __G.rig.yaw);
    await guest.mouse.move(620, 380);
    await guest.waitForFunction((before) => Math.abs(__G.rig.yaw - before) > 0.001, { timeout: 10000, polling: 100 }, yaw);
    await guest.evaluate(() => __G.input.exitLock());
    await guest.waitForFunction(() => __inkwave.menus.current === 'pause', { polling: 100 });
    await guest.evaluate(() => __inkwave.resume());
    await guest.waitForFunction(() => !__inkwave.menus.current, { polling: 100 });
    await guest.evaluate(() => { __G.net.leave(); });
    await page.evaluate(() => __G.net.leave());
    await guestBrowser.close(); guestBrowser = null;
    console.log('Online aiming ok: independent guest recovered from denied capture, mouse turned the camera, unlock opened pause and resume worked');
  }
  assert.deepEqual(errors, []);
  console.log('desktop ok: packaged app launched without JavaScript or asset errors');
  await browser.close(); browser = null;
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise((res) => setTimeout(res, 5000))]);
  const state = JSON.parse(await readFile(path.join(profile, 'window-state.json'), 'utf8'));
  assert.equal(state.port, Number(new URL(initial.origin).port));
} finally {
  await guestBrowser?.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), new Promise((res) => setTimeout(res, 5000))]); }
  const cleanupPath = path.resolve(profile);
  if (path.dirname(cleanupPath) !== path.resolve(tmpdir()) || !path.basename(cleanupPath).startsWith('inkwave-desktop-test-')) {
    throw new Error('Refusing to clean an unexpected test profile path: ' + cleanupPath);
  }
  await rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
