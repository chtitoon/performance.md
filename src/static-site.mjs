// The static-site artifact type: a site built to a folder of files (spec: Artifact types).
// Ported from Hutch's check-performance.mjs, reading HTML with parse5 instead of regexes.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, matchesGlob, posix, sep } from 'node:path';
import { parse } from 'parse5';

const files = (dir) => readdirSync(dir, { recursive: true }).map((file) => file.split(sep).join(posix.sep)).filter((file) => statSync(join(dir, file)).isFile());

// The site's pages, every .html file in `dist`, as [{ target, file }] sorted by file. A target is the
// path that serves the page: `/` for index.html, `/blog/` for blog/index.html, and `/privacy`
// for privacy.html with clean URLs (`/privacy.html` without).
export function pages(dist, { cleanUrls = false } = {}) {
  return files(dist)
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => ({ target: targetOf(file, cleanUrls), file }));
}

export function targetOf(file, cleanUrls) {
  if (file === 'index.html' || file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  return `/${cleanUrls ? file.slice(0, -'.html'.length) : file}`;
}

// The file in `dist` that a URL path serves, or undefined: the file itself, `<path>/index.html`, and
// with clean URLs `<path>.html`. The same lookup serves builds in `measure`.
export function fileFor(dist, path, { cleanUrls = false } = {}) {
  const relative = path.replace(/^\/+/, '');
  const candidates = [relative, posix.join(relative, 'index.html'), ...(cleanUrls && relative ? [`${relative.replace(/\/$/, '')}.html`] : [])];
  return candidates.find((c) => c && existsSync(join(dist, c)) && statSync(join(dist, c)).isFile());
}

// Targets whose artifact differs between two builds (spec: Changed pages). A page changed if its HTML
// did; files matching `hashedAssets` are skipped, since a change to one renames it and so changes the
// HTML that links it. Any other file that differs, appears or disappears changes every page. Pages
// only in `base` aren't listed: head has nothing left to measure.
export function changedPages(base, head, { cleanUrls = false, hashedAssets } = {}) {
  const skip = (file) => hashedAssets !== undefined && matchesGlob(file, hashedAssets);
  const same = (file) => existsSync(join(base, file)) && readFileSync(join(base, file)).equals(readFileSync(join(head, file)));
  const headFiles = files(head).filter((f) => !skip(f));
  const shared = headFiles.filter((f) => !f.endsWith('.html')).some((f) => !same(f))
    || files(base).some((f) => !f.endsWith('.html') && !skip(f) && !existsSync(join(head, f)));
  return pages(head, { cleanUrls }).filter(({ file }) => shared || !same(file)).map((p) => p.target);
}

const FONT = /\.(woff2?|ttf|otf|eot)$/i;
const kindOf = (url) => (FONT.test(url) ? 'fonts' : /\.css$/i.test(url) ? 'css' : /\.m?js$/i.test(url) ? 'js' : 'images');
const attr = (element, name) => element.attrs.find((a) => a.name === name)?.value;
const isScript = (element) => [undefined, '', 'module', 'text/javascript', 'application/javascript'].includes(attr(element, 'type')?.toLowerCase());

// Elements of a parsed document in order, skipping <template> content, which isn't loaded.
function* elements(node) {
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    yield child;
    yield* elements(child);
  }
}

// Code points that could render on the page: its text outside <script>, <style>, <template> and <noscript>.
function pageCodePoints(document) {
  const codePoints = new Set();
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') for (const c of child.value) codePoints.add(c.codePointAt(0));
      else if (!['script', 'style', 'template', 'noscript'].includes(child.tagName)) walk(child);
    }
  };
  walk(document);
  return codePoints;
}

function inRange(codePoints, unicodeRange) {
  if (!unicodeRange) return true;
  const ranges = unicodeRange.split(',').map((r) => {
    const [lo, hi = lo] = r.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(lo.replace(/\?/g, '0'), 16), parseInt(hi.replace(/\?/g, 'f'), 16)];
  });
  for (const cp of codePoints) if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  return false;
}

// What one page makes the browser download (spec: What counts as a page's download), as uncompressed
// bytes on disk. Returns { totals: { html, css, js, fonts, images, total }, images: [{ path, bytes }],
// offsite: [url], missing: [path], undimensioned: [src] }: resources from other origins can't be
// sized, so they're listed for the `origins` rule instead.
export function measurePage(dist, file, { origin, cleanUrls = false, fonts = 'unicode-range' }) {
  const site = new URL(origin);
  const html = readFileSync(join(dist, file), 'utf8');
  const document = parse(html);
  const codePoints = fonts === 'all' ? undefined : pageCodePoints(document);
  const totals = { html: Buffer.byteLength(html), css: 0, js: 0, fonts: 0, images: 0 };
  const images = [];
  const offsite = new Set();
  const missing = new Set();
  const seen = new Set();

  // Finds the file in dist that a URL in `from` (a file in dist) loads, as { path, bytes }. A URL to
  // another origin is noted for the origins rule and a file missing from dist is noted as missing;
  // neither can be sized. data:, mailto: and fragment URLs load nothing.
  const sizeOf = (url, from) => {
    url = url.trim();
    if (!url || url.startsWith('#') || !URL.canParse(url, new URL(from, site))) return undefined;
    const absolute = new URL(url, new URL(from, site));
    if (!['http:', 'https:'].includes(absolute.protocol)) return undefined;
    if (absolute.origin !== site.origin) return void offsite.add(absolute.href);
    const pathname = decodeURIComponent(absolute.pathname);
    const path = fileFor(dist, pathname, { cleanUrls });
    if (!path) return void missing.add(pathname);
    return { path, bytes: statSync(join(dist, path)).size };
  };

  const count = (kind, found) => {
    if (!found || seen.has(found.path)) return;
    seen.add(found.path);
    totals[kind] += found.bytes;
    if (kind === 'css') stylesheet(readFileSync(join(dist, found.path), 'utf8'), found.path);
    if (kind === 'images') images.push(found);
  };
  const add = (kind, url, from) => count(kind, sizeOf(url, from));
  // Of an image's candidates (src, srcset, a <picture>'s sources), the browser loads one: count the
  // largest, an upper bound.
  const addLargest = (urls, from) => count('images', urls.map((url) => sizeOf(url, from)).filter(Boolean).sort((a, b) => b.bytes - a.bytes)[0]);

  // What one stylesheet adds: browsers fetch the first source of a @font-face only when the page has
  // characters in its unicode-range. Weights aren't resolved, so every weight that matches counts.
  // `from` is where the CSS lives: its stylesheet, or the page for inline CSS.
  function stylesheet(css, from) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      const first = body.match(/src\s*:[^;]*?url\(\s*["']?([^"')]+)/)?.[1];
      if (first && (!codePoints || inRange(codePoints, body.match(/unicode-range\s*:\s*([^;]+)/)?.[1]))) add('fonts', first, from);
    }
    const rest = css.replace(/@font-face\s*{[^}]*}/g, '');
    for (const [, url] of rest.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/g)) add('css', url, from);
    for (const [, url] of rest.matchAll(/url\(\s*["']?([^"')]+)/g)) if (!/\.css$/i.test(url)) add(kindOf(url), url, from);
  }

  // A request the spec doesn't count in sizes: only its origin matters, so only off-site URLs are kept.
  const contact = (url) => {
    const absolute = URL.canParse(url.trim(), new URL(file, site)) ? new URL(url.trim(), new URL(file, site)) : undefined;
    if (absolute && ['http:', 'https:'].includes(absolute.protocol) && absolute.origin !== site.origin) offsite.add(absolute.href);
  };

  const undimensioned = [];
  const candidates = (element) => [attr(element, 'src'), ...(attr(element, 'srcset') ?? '').split(',').map((c) => c.trim().split(/\s+/)[0])].filter(Boolean);
  for (const element of elements(document)) {
    const { tagName } = element;
    const text = () => element.childNodes.filter((n) => n.nodeName === '#text').map((n) => n.value).join('');
    if (tagName === 'style') {
      // Inline CSS counts as CSS, not HTML, so a stylesheet costs the same budget inlined or not.
      const bytes = Buffer.byteLength(text());
      totals.html -= bytes;
      totals.css += bytes;
      stylesheet(text(), file);
    } else if (tagName === 'script' && isScript(element)) {
      const src = attr(element, 'src');
      if (src) add('js', src, file);
      else {
        const bytes = Buffer.byteLength(text());
        totals.html -= bytes;
        totals.js += bytes;
      }
    } else if (tagName === 'link' && attr(element, 'href')) {
      const rel = (attr(element, 'rel') ?? '').toLowerCase().split(/\s+/);
      const href = attr(element, 'href');
      const as = attr(element, 'as');
      if (rel.includes('stylesheet')) add('css', href, file);
      else if (rel.includes('icon')) add('images', href, file);
      else if (rel.includes('modulepreload')) add('js', href, file);
      else if (rel.includes('preload')) add({ font: 'fonts', style: 'css', script: 'js', image: 'images' }[as] ?? kindOf(href), href, file);
      // Not downloaded for this page, but still a request to that origin.
      else if (rel.some((r) => ['prefetch', 'preconnect', 'dns-prefetch', 'manifest', 'apple-touch-icon'].includes(r))) contact(href);
    } else if (tagName === 'img') {
      const sources = element.parentNode?.tagName === 'picture' ? element.parentNode.childNodes.filter((n) => n.tagName === 'source').flatMap(candidates) : [];
      addLargest([...candidates(element), ...sources], file);
      if (!(attr(element, 'width') && attr(element, 'height'))) undimensioned.push(attr(element, 'src') ?? '');
    } else if (['iframe', 'embed', 'object', 'video', 'audio', 'source', 'track'].includes(tagName)) {
      // Outside the spec's download list, but each loads from somewhere: the origins rule sees them.
      for (const url of [attr(element, 'src'), attr(element, 'data'), attr(element, 'poster')].filter(Boolean)) contact(url);
    }
    const style = attr(element, 'style');
    if (style) for (const [, url] of style.matchAll(/url\(\s*["']?([^"')]+)/g)) add(kindOf(url), url, file);
  }

  totals.total = totals.html + totals.css + totals.js + totals.fonts + totals.images;
  return { totals, images, offsite: [...offsite], missing: [...missing], undimensioned };
}

export const imageFormat = (path) => extname(path).slice(1).toLowerCase();
