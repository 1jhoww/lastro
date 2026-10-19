// Local production-export host for repeatable audits. Never publishes an artifact.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(process.argv[2] || '.local/phase9-baseline-web');
if (!root.startsWith(path.resolve('.local') + path.sep))
  throw new Error('Use an audit export under .local');
const cache = new Map();
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(root, 'index.html');
    if (!cache.has(file)) {
      const bytes = fs.readFileSync(file);
      cache.set(file, { raw: bytes, gzip: zlib.gzipSync(bytes) });
    }
    const compressed = /gzip/.test(req.headers['accept-encoding'] || '');
    const body = cache.get(file)[compressed ? 'gzip' : 'raw'];
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      Vary: 'Accept-Encoding',
      ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(body);
  })
  .listen(8081, '127.0.0.1', () => console.log('Local export host: http://localhost:8081'));
