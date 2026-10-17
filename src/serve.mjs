// Serving a static-site build for `measure`, the way a host like Cloudflare Pages does: URL paths
// find files by the artifact's routes, and text is compressed, so Lighthouse sees realistic
// transfer sizes.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileFor } from './static-site.mjs';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const COMPRESSIBLE = /^(text\/|image\/svg|application\/(json|manifest\+json|xml))/;

// Serves `dist` on a free local port. Returns { origin, close }.
export async function serve(dist, { cleanUrls = false } = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = fileFor(dist, path, { cleanUrls });
    if (!file) return res.writeHead(404).end();
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    let body = readFileSync(join(dist, file));
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    if (COMPRESSIBLE.test(type)) {
      body = gzipSync(body);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
