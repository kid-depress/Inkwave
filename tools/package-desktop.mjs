// Package the vendored game without development tools, local secrets or installed node_modules.
import { packager } from '@electron/packager';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const desktop = JSON.parse(await readFile(path.join(root, 'electron', 'config.json'), 'utf8'));
const flag = (key, fallback) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.split('=')[1] || fallback;
const platform = flag('platform', process.platform);
const arch = flag('arch', process.arch).split(',');
const distRoot = path.resolve(root, 'dist');
const outputRoot = path.resolve(distRoot, flag('release', ''));
const outputRelative = path.relative(distRoot, outputRoot);
if (path.isAbsolute(outputRelative) || outputRelative.startsWith('..')) throw new Error('Release output must stay inside dist/.');
const keep = new Set(['index.html', 'package.json', 'LICENSE', 'electron', 'src', 'styles', 'assets', 'songs', 'vendor']);
const options = {
  dir: root, name: 'INKWAVE', platform, arch, out: outputRoot, overwrite: true,
  appVersion: pkg.version, appCopyright: 'Copyright © 2026 Jayden Davis',
  asar: { unpackDir: 'songs' }, prune: false,
  ignore: (name) => name !== '' && !keep.has(name.replace(/^[/\\]+/, '').split(/[/\\]/)[0]),
  sanitizePackageJson: [(data) => {
    delete data.dependencies; delete data.devDependencies; delete data.scripts;
    return data;
  }],
};
if (platform === 'win32') Object.assign(options, {
  icon: path.join(root, 'build', 'icon.ico'),
  win32metadata: { CompanyName: 'Jayden Davis', ProductName: 'INKWAVE', FileDescription: 'INKWAVE 墨水射击游戏', OriginalFilename: 'INKWAVE.exe' },
});
if (platform === 'darwin') Object.assign(options, {
  icon: path.join(root, 'build', 'icon.icns'), appBundleId: 'local.inkwave.game', appCategoryType: 'public.app-category.action-games',
  extendInfo: path.join(root, 'build', 'extend-info.plist'), darwinDarkModeSupport: true,
});

const outputs = await packager(options);
for (const output of outputs) {
  if (platform === 'win32') await writeFile(path.join(output, '使用说明.txt'), '\uFEFF' + [
    'INKWAVE Windows 64 位免安装版', '',
    '请先完整解压，再双击 INKWAVE.exe 启动。运行时不需要安装 Node.js 或 Python。',
    '请保留整个文件夹，不能只把 INKWAVE.exe 单独拷走。', '',
    '默认使用简体中文，可在 设置 → 游戏 → 语言 中切换。',
    '联机：进入 在线游戏 创建房间，将 5 位邀请码发给好友；好友加入后准备，由房主开始。',
    `此版本默认连接 ${desktop.relay}，无需额外运行本地中继。`,
    '离线模式无需联网，在线模式需要能够访问上述中继。', '',
    'WASD 移动，鼠标瞄准，左键射击，Shift 潜入墨水，空格跳跃，右键/E 副武器，F 特殊技能。',
    'Esc 暂停，F11 切换全屏。设置与进度保存在本机用户目录。', '',
    '原作者：Jayden Davis；许可证：MIT（游戏源码许可证保存在 resources/app.asar 的 LICENSE）。',
  ].join('\r\n'), 'utf8');
  console.log(`Application: ${output}`);
  if (platform === 'win32' && process.platform === 'win32') {
    const zip = path.join(outputRoot, `INKWAVE-${pkg.version}-Windows-${path.basename(output).split('-').at(-1)}.zip`);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -LiteralPath $env:INKWAVE_PACKAGE_DIR -DestinationPath $env:INKWAVE_PACKAGE_ZIP -CompressionLevel Optimal -Force'], {
      windowsHide: true, stdio: 'inherit', env: { ...process.env, INKWAVE_PACKAGE_DIR: output, INKWAVE_PACKAGE_ZIP: zip },
    });
    if (result.status !== 0) throw new Error('ZIP creation failed; the packaged application folder is still available.');
    console.log(`Shareable ZIP: ${zip}`);
  }
}
