import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { METRICS, RUN_FLAGS, browserOf, checkVersion, readReport } from '../src/lighthouse.mjs';
import { runMeasure } from '../src/measure.mjs';
import { serve } from '../src/serve.mjs';
import { fixtures, folder, root } from './helpers.mjs';

const dist = join(fixtures, 'site/dist');

// A runner that records each URL it's given and reports made-up metrics, so measure can be tested
// without Lighthouse or a browser.
function fakeRunner({ fail } = {}) {
  const calls = [];
  const runner = {
    async start() { calls.push('start'); },
    async run(url, { preset }) {
      calls.push(`${preset} ${url.replace(/127\.0\.0\.1:\d+/, 'local')}`);
      if (fail && calls.length === fail) throw Object.assign(new Error('boom'), { raw: { failed: url } });
      return { toolVersion: '12.6.1', browser: 'Chrome/141.0.7390.54', metrics: { lcp: { value: 1000 + calls.length, unit: 'ms' }, cls: { value: 0, unit: '' } }, raw: { url } };
    },
    async stop() { calls.push('stop'); },
  };
  return { calls, runners: { lighthouse: async () => runner } };
}

// A site with the fixture's pages and a PERFORMANCE.md with `measure` settings (YAML lines).
function site(measure, { artifact = true } = {}) {
  const dir = folder({
    'PERFORMANCE.md': `---\nversion: "1.0"\nname: site\n${artifact ? 'artifact: { type: static-site, dist: dist, origin: "https://example.com", routes: { clean_urls: true } }\n' : ''}measure:\n  tool: lighthouse\n${measure}\n---\n`,
  });
  if (artifact) cpSync(dist, join(dir, 'dist'), { recursive: true });
  return dir;
}
const results = (dir, out = 'out') => readFileSync(join(dir, out, 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const quietly = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test('a build is served the way the artifact says, with text compressed', async () => {
  const server = await serve(dist, { cleanUrls: true });
  try {
    // fetch() decompresses, so the body reads as the file and the header says it was sent gzipped.
    const page = await fetch(`${server.origin}/privacy`);
    assert.deepEqual([page.status, page.headers.get('content-type'), page.headers.get('content-encoding')], [200, 'text/html', 'gzip']);
    assert.equal(await page.text(), readFileSync(join(dist, 'privacy.html'), 'utf8'));
    const font = await fetch(`${server.origin}/_astro/latin.a1b2c3.woff2`);
    assert.deepEqual([font.headers.get('content-type'), font.headers.get('content-encoding')], ['font/woff2', null]);
    assert.equal((await fetch(`${server.origin}/blog/`)).status, 200);
    assert.equal((await fetch(`${server.origin}/nope`)).status, 404);
  } finally {
    await server.close();
  }
  const strict = await serve(dist);
  try {
    assert.equal((await fetch(`${strict.origin}/privacy`)).status, 404);
    assert.equal((await fetch(`${strict.origin}/privacy.html`)).status, 200);
  } finally {
    await strict.close();
  }
});

test('measure alternates base and head, run by run, and measures a new page on head only', async () => {
  const dir = site('  runs: 2\n  preset: desktop');
  cpSync(join(dir, 'dist'), join(dir, 'base'), { recursive: true });
  rmSync(join(dir, 'base/privacy.html'));
  const { calls, runners } = fakeRunner();
  assert.equal(await quietly(() => runMeasure({ head: 'dist', base: 'base' }, ['out', '/', '/privacy'], dir, runners)), 0);
  assert.deepEqual(calls, [
    'start',
    'desktop http://local/', 'desktop http://local/', 'desktop http://local/privacy',
    'desktop http://local/', 'desktop http://local/', 'desktop http://local/privacy',
    'stop',
  ]);
  const lines = results(dir);
  assert.equal(lines.length, 6 * 2);
  assert.deepEqual(lines[0], { name: 'site', tool: 'lighthouse', tool_version: '12.6.1', browser: 'Chrome/141.0.7390.54', side: 'base', target: '/', run: 1, metric: 'lcp', value: 1002, unit: 'ms' });
  assert.deepEqual(lines.map((l) => `${l.side} ${l.target} ${l.run}`).filter((_, i) => i % 2 === 0), ['base / 1', 'head / 1', 'head /privacy 1', 'base / 2', 'head / 2', 'head /privacy 2']);
  assert.deepEqual(readdirSync(join(dir, 'out/lighthouse')).sort(), ['base_-1.json', 'base_-2.json', 'head_-1.json', 'head_-2.json', 'head_privacy-1.json', 'head_privacy-2.json']);
  assert.match(readFileSync(join(dir, 'out/lighthouse/head_privacy-2.json'), 'utf8'), /^\{"url":"http:\/\/127\.0\.0\.1:\d+\/privacy"\}$/);
});

test('given two builds, only the pages that differ are measured, unless --all', async () => {
  const dir = site('  runs: 1');
  cpSync(join(dir, 'dist'), join(dir, 'base'), { recursive: true });
  writeFileSync(join(dir, 'base/privacy.html'), 'an older privacy page');
  const changed = fakeRunner();
  await quietly(() => runMeasure({ head: 'dist', base: 'base' }, ['out'], dir, changed.runners));
  assert.deepEqual(changed.calls.slice(1, -1), ['mobile http://local/privacy', 'mobile http://local/privacy']);
  const all = fakeRunner();
  await quietly(() => runMeasure({ head: 'dist', base: 'base', all: true }, ['out'], dir, all.runners));
  assert.equal(all.calls.length, 2 + 4 * 2);
  // A URL can't be compared file by file, so every page is measured.
  const url = fakeRunner();
  await quietly(() => runMeasure({ head: 'dist', base: 'https://example.com' }, ['out'], dir, url.runners));
  assert.equal(url.calls.length, 2 + 4 * 2);
});

test('when no page differs, nothing runs and the results are empty', async () => {
  const dir = site('  runs: 1');
  cpSync(join(dir, 'dist'), join(dir, 'base'), { recursive: true });
  const { calls, runners } = fakeRunner();
  const logged = [];
  const log = console.log;
  console.log = (line) => logged.push(line);
  try {
    assert.equal(await runMeasure({ head: 'dist', base: 'base' }, ['out'], dir, runners), 0);
  } finally {
    console.log = log;
  }
  assert.deepEqual(calls, []); // not even started: no Lighthouse needed
  assert.equal(readFileSync(join(dir, 'out/results.jsonl'), 'utf8'), '');
  assert.deepEqual(logged, ['No page differs from base: nothing to measure']);
});

test('targets are every page of the artifact by default, also when measuring a URL', async () => {
  const dir = site('  runs: 1');
  const { calls, runners } = fakeRunner();
  await quietly(() => runMeasure({ head: 'https://example.com/' }, ['out'], dir, runners));
  assert.deepEqual(calls.slice(1, -1), ['mobile https://example.com/404', 'mobile https://example.com/blog/', 'mobile https://example.com/', 'mobile https://example.com/privacy']);
});

test('with no artifact, targets are the command line\'s, or /', async () => {
  const dir = site('  runs: 1', { artifact: false });
  const first = fakeRunner();
  await quietly(() => runMeasure({ head: 'http://localhost:4321' }, ['out'], dir, first.runners));
  assert.deepEqual(first.calls.slice(1, -1), ['mobile http://localhost:4321/']);
  const second = fakeRunner();
  await quietly(() => runMeasure({ head: 'http://localhost:4321' }, ['out', '/a', '/b'], dir, second.runners));
  assert.deepEqual(second.calls.slice(1, -1), ['mobile http://localhost:4321/a', 'mobile http://localhost:4321/b']);
  await assert.rejects(runMeasure({ head: 'dist' }, ['out'], dir, second.runners), /serving one needs the artifact settings/);
});

test('a target the artifact does not have, or that is not a path, is refused', async () => {
  const dir = site('  runs: 1');
  await assert.rejects(runMeasure({ head: 'dist' }, ['out', '/pricing'], dir, fakeRunner().runners), /there is no page at \/pricing/);
  await assert.rejects(runMeasure({ head: 'dist' }, ['out', 'pricing'], dir, fakeRunner().runners), /pricing is not a target/);
});

test('a failed run stops measure, keeping the results written so far', async () => {
  const dir = site('  runs: 1');
  const { calls, runners } = fakeRunner({ fail: 3 });
  await assert.rejects(quietly(() => runMeasure({ head: 'dist' }, ['out'], dir, runners)), /lighthouse failed on head \/blog\/, run 1: boom/);
  assert.equal(calls.at(-1), 'stop');
  assert.equal(results(dir).length, 2);
  assert.deepEqual(readdirSync(join(dir, 'out/lighthouse')).sort(), ['head_404-1.json', 'head_blog_-1.json']); // the failed run's report too
  // A new measurement starts from empty results and reports.
  await quietly(() => runMeasure({ head: 'dist' }, ['out', '/'], dir, fakeRunner().runners));
  assert.deepEqual([results(dir).length, readdirSync(join(dir, 'out/lighthouse'))], [2, ['head_-1.json']]);
});

test('a Lighthouse report becomes the spec\'s metrics, in base units', () => {
  const audit = (numericValue) => ({ numericValue });
  const lhr = {
    requestedUrl: 'http://127.0.0.1:1/',
    lighthouseVersion: '12.6.1',
    categories: { performance: { score: 0.98 } },
    audits: {
      'first-contentful-paint': audit(812.4), 'largest-contentful-paint': audit(1203.9), 'total-blocking-time': audit(0),
      'cumulative-layout-shift': audit(0.071), 'total-byte-weight': audit(30512),
    },
  };
  assert.deepEqual(readReport(lhr), {
    toolVersion: '12.6.1',
    metrics: {
      score: { value: 98, unit: '' }, fcp: { value: 812.4, unit: 'ms' }, lcp: { value: 1203.9, unit: 'ms' },
      tbt: { value: 0, unit: 'ms' }, cls: { value: 0.071, unit: '' }, transfer: { value: 30512, unit: 'B' },
    },
  });
  assert.throws(() => readReport({ ...lhr, runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST', message: 'Status code: 404' } }), /couldn't load http:\/\/127.0.0.1:1\/: ERRORED_DOCUMENT_REQUEST Status code: 404/);
  assert.throws(() => readReport({ ...lhr, categories: { performance: { score: null } } }), /no score/);
  assert.equal(browserOf('HeadlessChrome/155.0.8059.84'), 'Chrome/155.0.8059.84');
  assert.equal(browserOf('Chrome/140.0.1.2'), 'Chrome/140.0.1.2');
});

test('runs skip only what no metric reads', () => {
  assert.deepEqual(RUN_FLAGS.onlyCategories, ['performance']);
  assert.equal(RUN_FLAGS.disableFullPageScreenshot, true);
  const read = Object.values(METRICS).map((m) => m.audit).filter(Boolean);
  assert.ok(read.length > 0);
  for (const audit of RUN_FLAGS.skipAudits) assert.ok(!read.includes(audit), `${audit} is skipped, but a metric reads it`);
});

test('only the pinned Lighthouse runs', () => {
  assert.doesNotThrow(() => checkVersion('12.6.1'));
  assert.throws(() => checkVersion('12.8.0'), /measure runs lighthouse 12.6.1, but 12.8.0 is installed: npm install --no-save lighthouse@12.6.1/);
});

test('measure without Lighthouse installed says how to install it', { skip: canResolve('lighthouse') && 'Lighthouse is installed here' }, () => {
  const dir = site('  runs: 1');
  const { status, stderr } = spawnSync(process.execPath, [join(root, 'bin/performance.mjs'), 'measure', 'out', '--head', 'dist'], { cwd: dir, encoding: 'utf8' });
  assert.deepEqual([status, stderr], [1, 'performance measure: measure needs Lighthouse, an optional dependency: npm install --no-save lighthouse@12.6.1\n']);
});

test('measure usage', () => {
  const cli = (args) => spawnSync(process.execPath, [join(root, 'bin/performance.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  assert.match(cli(['measure', 'out']).stderr, /--head is required/);
  assert.match(cli(['measure', '--head', 'dist']).stderr, /expected at least 1 argument, got 0/);
  assert.deepEqual([cli(['measure', 'out', '--head', 'dist', '--all', '/']).status, cli(['measure', 'out', '--head', 'dist', '--all', '/']).stderr], [2, 'performance measure: give --all or targets, not both\n']);
});

function canResolve(name) {
  try {
    import.meta.resolve(name);
    return true;
  } catch {
    return false;
  }
}
