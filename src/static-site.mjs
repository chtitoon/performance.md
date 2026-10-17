// The static-site artifact type: a site built to a folder of files (spec: Artifact types).
import { readdirSync } from 'node:fs';
import { posix, sep } from 'node:path';

// The site's pages, every .html file in `dist`, as [{ target, file }] sorted by file. A target is the
// path that serves the page: `/` for index.html, `/blog/` for blog/index.html, and `/privacy`
// for privacy.html with clean URLs (`/privacy.html` without).
export function pages(dist, { cleanUrls = false } = {}) {
  return readdirSync(dist, { recursive: true })
    .map((file) => file.split(sep).join(posix.sep))
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => ({ target: targetOf(file, cleanUrls), file }));
}

export function targetOf(file, cleanUrls) {
  if (file === 'index.html' || file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  return `/${cleanUrls ? file.slice(0, -'.html'.length) : file}`;
}
