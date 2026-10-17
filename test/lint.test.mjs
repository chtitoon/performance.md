import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from '../src/file.mjs';
import { lint } from '../src/lint.mjs';
import { fixtures, folder, readmeExample, specExample } from './helpers.mjs';

// Lints front matter given as YAML lines (the --- lines are added). Extra files go next to it.
function lintYaml(yaml, { files = {}, strict } = {}) {
  const dir = folder({ 'PERFORMANCE.md': `---\n${yaml}\n---\n\n# Performance\n`, ...files });
  return lint(readFile(join(dir, 'PERFORMANCE.md')), { strict });
}
const errors = (yaml, options) => lintYaml(yaml, options).errors.map((e) => e.message);
const warnings = (yaml, options) => lintYaml(yaml, options).warnings.map((e) => e.message);

const site = `version: "1.0"
artifact:
  type: static-site
  dist: dist
  origin: https://example.com`;
const lighthouse = (metrics, extra = '') => `version: "1.0"
measure:
  tool: lighthouse${extra}
  metrics:
${metrics.map((m) => `    - ${m}`).join('\n')}`;

test('the spec and README examples and the fixture site lint clean', () => {
  for (const content of [specExample(), readmeExample()]) {
    const example = lint(readFile(join(folder({ 'PERFORMANCE.md': content }), 'PERFORMANCE.md')));
    assert.deepEqual([example.errors, example.warnings, example.needs], [[], [], '1.0']);
  }
  const fixture = lint(readFile(join(fixtures, 'site/PERFORMANCE.md')), { strict: true });
  assert.deepEqual([fixture.errors, fixture.warnings, fixture.name], [[], [], 'site']);
});

test('version must be a supported, quoted major.minor', () => {
  assert.deepEqual(errors(site.replace('"1.0"', '1.0')), ['version: write it quoted, like version: "1.0"; unquoted, YAML reads 1.10 as the number 1.1']);
  assert.deepEqual(errors(site.replace('"1.0"', '"1.2"') + '\nsurfaces: []'), ['version: this file needs 1.2; this tool supports up to 1.0']);
  assert.deepEqual(errors(site.replace('"1.0"', '"2.0"')), ['version: this file needs 2.0; this tool supports version 1, up to 1.0']);
  assert.deepEqual(errors(site.replace('"1.0"', '"one"')), ['version: must be a quoted "major.minor" string, like "1.0"']);
  assert.deepEqual(errors(site.replace('version: "1.0"\n', '')), ['missing version']);
});

test('a file needs artifact, measure or both', () => {
  assert.deepEqual(errors('version: "1.0"'), ['needs artifact, measure or both']);
});

test('unknown keys are errors, x- keys are ignored, reserved keys are not supported yet', () => {
  assert.deepEqual(errors(`${site}\n  x-note: hi\n  budgets: { x-why: [1], totl: 1 KB }\nx-owner: me`), ['artifact.budgets.totl: unknown key; did you mean total?']);
  assert.deepEqual(errors(`${site}\n  exclude: [a]\nextends: base.md`), [
    'artifact.exclude: not supported yet: reserved for a later version of the format',
    'extends: not supported yet: reserved for a later version of the format',
  ]);
  assert.deepEqual(errors(lighthouse(['{ metric: lcp, stat: median, limit: 1 s, objective: 99%, window: 28d }'])), [
    'measure.metrics[0].objective: not supported yet: reserved for a later version of the format',
    'measure.metrics[0].window: not supported yet: reserved for a later version of the format',
  ]);
  assert.deepEqual(errors('version: "1.0"\nmeasure: { tool: command, command: ./run.sh }'), ['measure.tool: not supported yet: tool command is reserved for a later version of the format']);
});

test('an unknown artifact type or tool is reported once, without its settings', () => {
  assert.deepEqual(errors(`${site.replace('static-site', 'spa')}\n  budgets: { total: 1 }`), ['artifact.type: "spa" is not an artifact type; version 1.0 defines static-site']);
  assert.deepEqual(errors('version: "1.0"\nmeasure: [{ tool: k6, vus: 10 }]'), ['measure[0].tool: "k6" is not a tool; version 1.0 defines lighthouse']);
});

test('static-site settings', () => {
  assert.deepEqual(errors('version: "1.0"\nartifact: { type: static-site }'), ['artifact: missing dist', 'artifact: missing origin']);
  assert.deepEqual(errors(site.replace('https://example.com', 'example.com')), ['artifact.origin: "example.com" is not an origin: a scheme and host with no path, like https://example.com']);
  assert.deepEqual(errors(site.replace('dist: dist', 'dist: /var/www')), ['artifact.dist: paths in the file are relative to its folder']);
  assert.deepEqual(errors(`${site}\n  fonts: some\n  routes: { clean: true }`), [
    'artifact.fonts: "some" is not one of: unicode-range, all',
    'artifact.routes.clean: unknown key (known: clean_urls)',
  ]);
  assert.deepEqual(errors(`${site}\n  rules: { origins: [self, https://cdn.example.com, cdn], image_formats: [.png], image_dimensions: yes }`), [
    'artifact.rules.origins[2]: "cdn" is not self or an origin like https://cdn.example.com',
    'artifact.rules.image_formats[0]: ".png" is not a format: write a file extension in lower case, like webp',
    'artifact.rules.image_dimensions: must be true or false',
  ]);
});

test('sizes are budgets and requirements are rules, each in its own section', () => {
  assert.deepEqual(errors(`${site}\n  budgets: { origins: [self] }\n  rules: { total: 1 KB }`), [
    'artifact.budgets.origins: unknown key (known: total, html, css, js, fonts, images, image_max)',
    'artifact.rules.total: unknown key (known: image_formats, image_dimensions, origins)',
  ]);
  assert.deepEqual(errors(`${site}\n  overrides: { /: { total: 1 KB } }`, { files: { 'dist/index.html': '' } }), [
    'artifact.overrides["/"].total: unknown key (known: budgets, rules)',
  ]);
});

test('budgets take sizes, with a unit', () => {
  assert.deepEqual(errors(`${site}\n  budgets: { total: 175 KB, js: 0, css: 2 s, html: 13 kb, image_max: 1 MB }`), [
    'artifact.budgets.html: "13 kb" is not a quantity: a number, an optional space and a unit, like 175 KB, 2.5 s, 2% or 0.1',
    'artifact.budgets.js: 0 has no unit; js is a size, in B, KB or MB',
    'artifact.budgets.css: "2 s" is a time; css is a size, in B, KB or MB',
  ]);
  assert.deepEqual(errors(`${site}\n  overrides: { /: { budgets: { total: 1 } } }`, { files: { 'dist/index.html': '' } }), ['artifact.overrides["/"].budgets.total: 1 has no unit; total is a size, in B, KB or MB']);
});

test('metrics take units of their own dimension', () => {
  assert.deepEqual(errors(lighthouse([
    '{ metric: lcp, stat: median, limit: 2500, delta: 50 ms }',
    '{ metric: cls, stat: worst, limit: 0.1 s }',
    '{ metric: transfer, stat: median, delta: 2 KB }',
    '{ metric: score, stat: worst, limit: 90, delta: 101 }',
  ], '\n  noise: 0.02')), [
    'measure.noise: 0.02 has no unit; noise is a percentage, in %',
    'measure.metrics[0].limit: 2500 has no unit; lcp is a time, in ms or s',
    'measure.metrics[1].limit: "0.1 s" has a unit; cls is unitless',
    'measure.metrics[3].delta: score goes from 0 to 100',
  ]);
});

test('metrics entries: known metric and stat, emitted by the tool, limit or delta, unique', () => {
  assert.deepEqual(errors(lighthouse([
    '{ metric: lcp, stat: median, limit: 2.5 s }',
    '{ metric: lcp, stat: p95, limit: 3 s }',
    '{ metric: lcp, stat: median, delta: 50 ms }',
    '{ metric: ttfb, stat: median, limit: 1 s }',
    '{ metric: latency, stat: mean, limit: 1 s }',
    '{ metric: fcp, stat: average, limit: 1 s }',
    '{ metric: tbt, stat: median }',
  ], '\n  runs: 20')), [
    'measure.metrics[2]: lcp at median is listed twice; metric and stat together are unique',
    'measure.metrics[3].metric: "ttfb" is not one of: score, fcp, lcp, tbt, cls, transfer, latency, error_rate',
    "measure.metrics[4].metric: lighthouse doesn't emit latency; it emits score, fcp, lcp, tbt, cls, transfer",
    'measure.metrics[5].stat: "average" is not a stat: median, mean, min, max, worst or p<N>, like p95',
    'measure.metrics[6]: needs limit, delta or both',
  ]);
});

test('a percentile with too few runs to mean anything is a warning', () => {
  assert.deepEqual(warnings(lighthouse(['{ metric: lcp, stat: p95, limit: 3 s }'])), ['measure.metrics[0].stat: p95 of 5 runs is simply the maximum; it needs at least 20 runs to mean anything']);
  assert.deepEqual(warnings(lighthouse(['{ metric: lcp, stat: p95, limit: 3 s }', '{ metric: lcp, stat: p50, limit: 3 s }'], '\n  runs: 20')), []);
  // An override of the file's own entry doesn't repeat its warning.
  const overridden = `${site}\n${lighthouse(['{ metric: lcp, stat: p90, limit: 3 s }']).replace('version: "1.0"\n', '')}\n  overrides:\n    /: { metrics: [{ metric: lcp, stat: p90, limit: 4 s }] }`;
  assert.equal(warnings(overridden, { files: { 'dist/index.html': '' } }).length, 1);
});

test('measure may be a list, one entry per tool', () => {
  assert.deepEqual(errors('version: "1.0"\nmeasure:\n  - { tool: lighthouse }\n  - { tool: lighthouse, preset: desktop }'), [
    'measure[1].tool: lighthouse is already measured by measure[0]; results are keyed by tool, so each tool appears once',
  ]);
  assert.deepEqual(errors('version: "1.0"\nmeasure: []'), ['measure: needs at least 1 item']);
});

test('overrides must name pages the build has', () => {
  const yaml = `${site}\n  routes: { clean_urls: true }\n  overrides:\n    /privacy: { budgets: { html: 1 KB } }\n    /privacy.html: { budgets: { html: 1 KB } }\n    pricing: { budgets: { html: 1 KB } }\n${lighthouse(['{ metric: lcp, stat: median, limit: 1 s }']).replace('version: "1.0"\n', '')}\n  overrides:\n    /blog/: { metrics: [{ metric: lcp, stat: median, limit: 2 s }] }\n    /blog: { metrics: [{ metric: lcp, stat: median, limit: 2 s }] }`;
  const files = { 'dist/index.html': '', 'dist/privacy.html': '', 'dist/blog/index.html': '' };
  assert.deepEqual(errors(yaml, { files }), [
    'artifact.overrides["/privacy.html"]: dist/ has no page at /privacy.html',
    'artifact.overrides.pricing: "pricing" is not a target: targets are paths starting with /, like /pricing',
    'measure.overrides["/blog"]: dist/ has no page at /blog',
  ]);
  assert.deepEqual(warnings(yaml), [
    "artifact.overrides: can't check these targets until the site is built: dist doesn't exist",
    "measure.overrides: can't check these targets until the site is built: dist doesn't exist",
  ]);
  assert.deepEqual(warnings(lighthouse(['{ metric: lcp, stat: median, limit: 1 s }']) + '\n  overrides: { /a: { metrics: [] } }'), [
    "measure.overrides: can't check these targets: with no artifact, targets come from the command line",
  ]);
});

test('--strict wants every defaulted field written', () => {
  assert.deepEqual(errors(`${site}\nmeasure: { tool: lighthouse }`, { strict: true }).map((m) => m.replace(/default: performance-md-\w+\)$/, 'default: <dir>)')), [
    '--strict: write name (default: <dir>)',
    'artifact: --strict: write routes.clean_urls (default: false)',
    'artifact: --strict: write fonts (default: unicode-range)',
    'measure: --strict: write runs (default: 5)',
    'measure: --strict: write noise (default: 0%)',
    'measure: --strict: write preset (default: mobile)',
  ]);
});

test('findings point at their line', () => {
  const result = lintYaml(`${site}\n  budgets:\n    total: 1\n  bogus:\n    deep: 1`);
  assert.deepEqual(result.errors.map((e) => e.line), [8, 9]);
});

test('a file that cannot be read says why', () => {
  const read = (content) => lint(readFile(join(folder({ 'PERFORMANCE.md': content }), 'PERFORMANCE.md'))).errors;
  assert.match(read('# no front matter\n')[0].message, /no front matter/);
  assert.deepEqual(read('---\nversion: "1.0"\nversion: "1.0"\n---\n').map((e) => e.line), [3]);
  assert.match(read('---\n- a list\n---\n')[0].message, /must be a mapping/);
});