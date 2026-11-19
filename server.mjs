// Serves the built app (dist/) with plain Node: `npm run build && npm start`. PORT sets the port (default 3000).
// No dependencies; files are streamed with long caching for hashed assets and kits, and unknown paths fall back
// to index.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.woff2': 'font/woff2',
};

function send(res, file, status = 200) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const rel = path.relative(ROOT, file);
    const immutable = rel.startsWith(`assets${path.sep}`);
    res.writeHead(status, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : rel === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = path.resolve(ROOT, `.${path.posix.normalize(rel)}`);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (!err && st.isFile()) send(res, file);
      else if (!path.extname(rel)) send(res, path.join(ROOT, 'index.html'));
      else send(res, file); // 404
    });
  })
  .listen(PORT, () => console.log(`midi-viz on http://localhost:${PORT}`));
