import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)].map(match => match[1]);
assert(assets.some(p => p.endsWith('.js')), 'HTML must use relative JavaScript URLs');
assert(assets.some(p => p.endsWith('.css')), 'HTML must use relative stylesheet URLs');
assert(!/(?:src|href)="\/[^/]/.test(html), 'No root-relative assets');
const js = await readFile(path.join(dist, assets.find(p => p.endsWith('.js'))), 'utf8');
const worker = js.match(/"([^\"]*recommendation\.worker-[^\"]+\.js)"/);
assert(worker, 'Production bundle must contain a separate worker');
const scriptPath = assets.find(p => p.endsWith('.js'));
const workerUrl = new URL(worker[1], `http://localhost/${scriptPath.replace(/^\.\//, '')}`);
const server = createServer(async (request, response) => {
  try {
    let route = new URL(request.url, 'http://localhost').pathname;
    if (route.startsWith('/comic-frontinder-23/')) route = route.slice('/comic-frontinder-23'.length);
    if (route === '/') route = '/index.html';
    const target = path.resolve(dist, `.${decodeURIComponent(route)}`);
    if (!target.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(target);
    response.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const port = server.address().port;
  for (const prefix of ['/', '/comic-frontinder-23/']) {
    const base = `http://127.0.0.1:${port}${prefix}`;
    for (const hash of ['', '#/discover', '#/recommendations', '#/saved']) {
      const response = await fetch(base + hash);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), html);
    }
    for (const asset of assets) assert.equal((await fetch(new URL(asset, base))).status, 200, asset);
    const response = await fetch(new URL(workerUrl.pathname.slice(1), base));
    assert.equal(response.status, 200, 'Worker must resolve from the deployment path');
    assert.equal(response.headers.get('content-type'), 'application/javascript');
    console.log(`PASS ${prefix}: HTML, hash routes, stylesheet, icon, JS, and worker served`);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
