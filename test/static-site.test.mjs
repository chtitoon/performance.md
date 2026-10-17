import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { changedPages, fileFor, measurePage, pages } from '../src/static-site.mjs';
import { fixtures, folder } from './helpers.mjs';

const dist = join(fixtures, 'site/dist');
const size = (file) => statSync(join(dist, file)).size;
const measure = (file, options = {}) => measurePage(dist, file, { origin: 'https://example.com', cleanUrls: true, ...options });
// Measures one page given as HTML, with other files next to it.
const measureHtml = (html, files = {}, options = {}) => measurePage(folder({ 'index.html': html, ...files }), 'index.html', { origin: 'https://example.com', ...options });

test('targets are named by the path that serves them', () => {
  assert.deepEqual(pages(dist, { cleanUrls: true }).map((p) => p.target), ['/404', '/blog/', '/', '/privacy']);
  assert.deepEqual(pages(dist).map((p) => p.target), ['/404.html', '/blog/', '/', '/privacy.html']);
});

test('a URL path finds its file the way the site is served', () => {
  assert.equal(fileFor(dist, '/'), 'index.html');
  assert.equal(fileFor(dist, '/blog/'), 'blog/index.html');
  assert.equal(fileFor(dist, '/blog'), 'blog/index.html');
  assert.equal(fileFor(dist, '/privacy'), undefined);
  assert.equal(fileFor(dist, '/privacy', { cleanUrls: true }), 'privacy.html');
  assert.equal(fileFor(dist, '/favicon.svg'), 'favicon.svg');
});

test('a page counts its HTML, linked and inline CSS, @import, fonts in range, CSS images, icon and the largest srcset candidate', () => {
  const inlineCss = Buffer.byteLength('body { font-family: Sans; }');
  assert.deepEqual(measure('index.html').totals, {
    html: size('index.html') - inlineCss, // the JSON-LD script stays HTML
    css: inlineCss + size('_astro/site.5e6f7a.css') + size('_astro/extra.9a8b7c.css'),
    js: 0,
    fonts: size('_astro/latin.a1b2c3.woff2'), // no Cyrillic text, so no Cyrillic font
    images: size('favicon.svg') + size('images/bg.svg') + size('images/photo-large.webp'),
    total: 5183,
  });
});

test('fonts count by unicode-range unless fonts is all', () => {
  const both = size('_astro/latin.a1b2c3.woff2') + size('_astro/cyrillic.d4e5f6.woff2');
  assert.equal(measure('blog/index.html').totals.fonts, both);
  assert.equal(measure('index.html', { fonts: 'all' }).totals.fonts, both);
});

test('scripts and pictures', () => {
  const page = measure('privacy.html');
  const inlineJs = Buffer.byteLength('window.inline = true;');
  assert.equal(page.totals.js, size('_astro/app.f00d42.js') + inlineJs);
  assert.equal(page.totals.html, size('privacy.html') - inlineJs);
  assert.deepEqual(page.images.map((i) => i.path), ['favicon.svg', 'images/photo.avif']); // the picture's largest source
});

test('other origins are listed for the origins rule, never sized; plain links are not', () => {
  const page = measureHtml(`<link rel="stylesheet" href="https://fonts.example.net/a.css">
    <link rel="preconnect" href="https://cdn.example.org"><link rel="canonical" href="https://elsewhere.example/">
    <iframe src="https://video.example/embed"></iframe><img src="//img.example/a.webp" width="1" height="1">
    <a href="https://example.org/">link</a><img src="data:image/gif;base64,R0lGOD" width="1" height="1">
    <style>.a { background: url(#gradient) }</style>`);
  assert.deepEqual(page.offsite.sort(), ['https://cdn.example.org/', 'https://fonts.example.net/a.css', 'https://img.example/a.webp', 'https://video.example/embed']);
  assert.equal(page.totals.css, Buffer.byteLength('.a { background: url(#gradient) }'));
  assert.deepEqual(page.missing, []);
});

test('files the page links but the build lacks are listed as missing', () => {
  assert.deepEqual(measureHtml('<link rel="stylesheet" href="/gone.css"><script src="app.js"></script>').missing, ['/gone.css', '/app.js']);
});

test('images without width and height are listed', () => {
  assert.deepEqual(measureHtml('<img src="/a.webp" width="1"><img src="/b.webp" width="1" height="1"><img src="/c.webp" height="1">', { 'a.webp': 'a', 'b.webp': 'b', 'c.webp': 'c' }).undimensioned, ['/a.webp', '/c.webp']);
});

test('a resource is counted once per page, and attributes need no particular quoting', () => {
  const page = measureHtml(`<link rel=stylesheet href=/a.css><link rel='stylesheet' href='/a.css'><div style="background:url(/i.svg)"></div><img src=/i.svg width=1 height=1>`, { 'a.css': 'p{}', 'i.svg': '<svg/>' });
  assert.deepEqual([page.totals.css, page.totals.images], [3, 6]);
});

test('changed: HTML that differs, or any unhashed file, which changes every page', () => {
  const site = { 'index.html': 'home', 'about.html': 'about', 'favicon.svg': 'icon', '_astro/a.123.css': 'a' };
  const base = folder(site);
  const options = { cleanUrls: true, hashedAssets: '_astro/**' };
  assert.deepEqual(changedPages(base, folder(site), options), []);
  assert.deepEqual(changedPages(base, folder({ ...site, 'about.html': 'about!', '_astro/a.123.css': undefined, '_astro/a.456.css': 'b' }), options), ['/about']);
  assert.deepEqual(changedPages(base, folder({ ...site, 'new.html': 'new' }), options), ['/new']);
  assert.deepEqual(changedPages(base, folder({ ...site, 'favicon.svg': 'icon!' }), options), ['/about', '/']);
  assert.deepEqual(changedPages(base, folder({ ...site, '_headers': '/*\n  X: y' }), options), ['/about', '/']);
  const { 'favicon.svg': _, ...withoutFavicon } = site;
  assert.deepEqual(changedPages(base, folder(withoutFavicon), options), ['/about', '/']);
  // Without hashed_assets, a renamed asset changes every page.
  assert.deepEqual(changedPages(base, folder({ ...site, '_astro/a.123.css': 'b' }), { cleanUrls: true }), ['/about', '/']);
});
