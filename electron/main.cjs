// Electron shell: bundled assets are served on loopback, with the native window isolated from Node.js.
const { app, BrowserWindow, Menu, shell, powerSaveBlocker, ipcMain, screen, nativeTheme, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startGameServer } = require('./local-server.cjs');
const desktopConfig = require('./config.json');

const ROOT = path.join(__dirname, '..');
let gameHost = null;
const smoke = process.argv.includes('--inkwave-smoke');

// Allow a separate, disposable profile when checking the packaged app.
const profileArg = process.argv.find((arg) => arg.startsWith('--inkwave-user-data='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice('--inkwave-user-data='.length)));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

// Metal is macOS-specific; ANGLE chooses the native backend on Windows/Linux.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",   // index.html's import map + fade-in snippet are inline
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' data: blob: ${new URL(desktopConfig.relay).origin}`,
  "worker-src 'self' blob:",
].join('; ');

// ---- window state (size + fullscreen), remembered between launches; first launch opens fullscreen
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return { fullscreen: true, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; } catch { return { fullscreen: true }; }
}
function saveState(win) {
  try {
    const s = { fullscreen: win.isFullScreen(), bounds: win.isFullScreen() ? loadState().bounds : win.getNormalBounds() };
    fs.writeFileSync(stateFile(), JSON.stringify({ ...s, port: gameHost?.port }));
  } catch { /* non-fatal */ }
}
function onScreen(b) {
  return b && screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

function createWindow() {
  const state = loadState();
  const bounds = onScreen(state.bounds) ? state.bounds : { width: 1440, height: 900 };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    title: 'INKWAVE',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: '#0d1020',
    fullscreen: smoke ? false : !!state.fullscreen,
    show: !smoke,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: !smoke, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadURL(`${gameHost.url}/index.html${smoke ? '?quality=low' : ''}`);
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== gameHost.url) event.preventDefault();
  });
  // Keep any outbound links in the user's browser instead of inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fullscreen. macOS ignores requests made mid-transition, so remember the wanted state and re-apply it once the
  // animation ends. Shortcuts are caught before the page sees them, so the game's key handling / pointer lock can't eat them.
  // `ours` marks a transition we started; any other (green button, View menu) just becomes the new wanted state.
  let want = win.isFullScreen(), ours = false;
  const setFs = (on) => { want = !!on; if (win.isFullScreen() !== want) { ours = true; win.setFullScreen(want); } };
  const settled = () => {
    const now = win.isFullScreen();
    if (ours && now !== want) { win.setFullScreen(want); return; }
    ours = false; want = now;
    if (!win.webContents.isDestroyed()) win.webContents.send('fs:changed', now);
    saveState(win);
  };
  win.on('enter-full-screen', settled);
  win.on('leave-full-screen', settled);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    // ⌘Q quits from anywhere (menus, a match with the mouse captured, fullscreen), whatever the page does with keys
    if (process.platform === 'darwin' && input.meta && !input.control && !input.alt && k === 'q') { e.preventDefault(); app.quit(); return; }
    const hit = k === 'f11' || (input.meta && input.control && k === 'f') || (input.meta && k === 'enter');
    if (!hit) return;
    e.preventDefault();
    if (!input.isAutoRepeat) setFs(!want);
  });
  ipcMain.removeAllListeners('fs:set'); ipcMain.removeAllListeners('fs:get');
  ipcMain.on('fs:set', (_e, on) => setFs(on));
  ipcMain.on('fs:get', (e) => { e.returnValue = win.isFullScreen(); });

  win.on('resized', () => saveState(win));
  win.on('moved', () => saveState(win));
  win.on('close', () => saveState(win));

  // Stop App Nap from throttling the game loop while it's focused; release when in the background.
  let blocker = null;
  win.on('focus', () => { if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension'); });
  win.on('blur', () => { if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; } });
  return win;
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { label: 'GPU Info', click: () => new BrowserWindow({ width: 900, height: 700 }).loadURL('chrome://gpu') },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  gameHost = await startGameServer({ root: ROOT, port: loadState().port || 18490, csp: CSP });
  // Reuse the same origin on later launches so settings, progression and language persist.
  fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), port: gameHost.port }));
  ipcMain.on('desktop:get-config', (event) => { event.returnValue = desktopConfig; });
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('[desktop]', error);
  if (!smoke) dialog.showErrorBox('INKWAVE 启动失败', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { gameHost?.server.close(); gameHost?.server.closeIdleConnections(); });
