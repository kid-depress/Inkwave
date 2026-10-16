import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startGameServer } from '../electron/local-server.cjs';

const host = await startGameServer({ root: fileURLToPath(new URL('../', import.meta.url)), port: 0, csp: "default-src 'self'" });
let fallback;
try {
  let response = await fetch(host.url + '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'self'");
  assert.match(await response.text(), /INKWAVE/);
  response = await fetch(host.url + '/src/main.js');
  assert.match(response.headers.get('content-type'), /javascript/);
  for (const url of ['/electron/config.json', '/package.json', '/node_modules/electron/package.json', '/%2e%2e%5celectron%5cmain.cjs']) {
    response = await fetch(host.url + url);
    assert.equal(response.status, 403, url);
  }
  assert.equal((await fetch(host.url + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(host.url + '/', { method: 'POST' })).status, 405);
  response = await fetch(host.url + '/assets/icon.png', { headers: { Range: 'bytes=0-7' } });
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal((await fetch(host.url + '/assets/icon.png', { headers: { Range: 'bytes=7-3' } })).status, 416);
  response = await fetch(host.url + '/assets/icon.png', { headers: { Range: 'bytes=-8' } });
  assert.equal(response.status, 206);
  assert.equal(Number(response.headers.get('content-length')), 8);
  fallback = await startGameServer({ root: '.', port: host.port });
  assert.notEqual(fallback.port, host.port);
  console.log('desktop server ok: module MIME types, CSP, asset scope, byte ranges and occupied-port fallback');
} finally {
  for (const item of [host, fallback].filter(Boolean)) {
    item.server.closeAllConnections();
    await new Promise((resolve) => item.server.close(resolve));
  }
}
