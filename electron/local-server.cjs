// Serve bundled files only on loopback. A stable HTTP origin preserves localStorage and is accepted by the relay.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
};
const PUBLIC = new Set(['index.html', 'src', 'styles', 'assets', 'songs', 'vendor']);

async function startGameServer({ root, port = 18490, csp = '' }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const url = new URL(req.url, 'http://127.0.0.1');
      // The browser's dev diagnostics are optional; they must not cause errors in the desktop app.
      if (url.pathname.startsWith('/__inkwave_error/')) { res.writeHead(204).end(); return; }
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(root, '.' + pathname);
      const rel = path.relative(root, file);
      if (path.isAbsolute(rel) || rel.startsWith('..') || !PUBLIC.has(rel.split(path.sep)[0])) { res.writeHead(403).end(); return; }
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) { res.writeHead(404).end(); return; }
      const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
      if (file.endsWith('.html')) headers['Content-Security-Policy'] = csp;
      let start = 0, end = stat.size - 1, status = 200;
      if (req.headers.range) {
        const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (range && (range[1] || range[2])) {
          start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
          end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        }
        if (!range || !(range[1] || range[2]) || start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        headers['Content-Length'] = end - start + 1;
      }
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error instanceof URIError ? 400 : 404).end();
      else res.destroy();
    }
  });
  const listen = (listenPort) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  try { await listen(port); }
  catch (error) { if (error.code !== 'EADDRINUSE' || port === 0) throw error; await listen(0); }
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { startGameServer };
