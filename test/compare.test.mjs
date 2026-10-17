import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, folder, root } from './helpers.mjs';

const cli = (args, cwd) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, 'bin/performance-md.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status, stdout, stderr };
};

// A surface named web with these measure settings (YAML lines under `measure:`), and results given
// as { 'side target metric': [values, one per run] } with the metric's base unit.
const UNIT = { score: '', fcp: 'ms', lcp: 'ms', tbt: 'ms', cls: '', transfer: 'B' };
function surface(measure, results, { extra = [] } = {}) {
  const lines = Object.entries(results).flatMap(([key, values]) => {
    const [side, target, metric] = key.split(' ');
    return values.map((value, i) => JSON.stringify({ name: 'web', tool: 'lighthouse', tool_version: '12.6.1', browser: 'Chrome/155.0.8059.84', side, target, run: i + 1, metric, value, unit: UNIT[metric] }));
  });
  return folder({
    'PERFORMANCE.md': `---\nversion: "1.0"\nname: web\nmeasure:\n  tool: lighthouse\n${measure}\n---\n`,
    'out/results.jsonl': [...lines, ...extra].join('\n') + '\n',
  });
}
const lcp = (entry) => `  noise: 2%\n  metrics:\n    - ${entry}`;

test('the recorded Hutch run (the same build as base and head) is on par, and earns no comment', () => {
  const { status, stdout } = cli(['compare', 'results', '--comment', 'comment.md'], join(fixtures, 'hutch'));
  assert.equal(status, 0);
  assert.equal(stdout, readFileSync(join(fixtures, 'hutch/report.txt'), 'utf8'));
  assert.equal(existsSync(join(fixtures, 'hutch/comment.md')), false);
});

test('worse by more than both delta and noise regresses; within either it is on par', () => {
  const entry = lcp('{ metric: lcp, stat: median, delta: 20 ms }');
  // 2% of 2000 ms is 40 ms, more than the 20 ms delta: 30 ms worse is noise.
  const noisy = surface(entry, { 'base / lcp': [2000, 2000, 2000], 'head / lcp': [2030, 2030, 2030] });
  assert.deepEqual(cli(['compare', 'out'], noisy), { status: 0, stdout: 'On par with base.\n\nLighthouse mobile, 5 runs per side, base → head, median unless noted.\n\n/\n  all: LCP 2.03 s\n\n', stderr: '' });
  const worse = surface(entry, { 'base / lcp': [2000, 2000, 2000], 'head / lcp': [2050, 2050, 2050] });
  const { status, stdout } = cli(['compare', 'out'], worse);
  assert.equal(status, 1);
  assert.match(stdout, /^❌ Failed\.\n[\s\S]*\/\n  🔴 LCP 2\.00 s → 2\.05 s\n[\s\S]*❌ past a limit · 🔴 worse than base by more than delta and noise; see measure.metrics in PERFORMANCE.md/);
});

test('an improvement earns a comment, unless something else regressed', () => {
  const entries = '  metrics:\n    - { metric: lcp, stat: median, delta: 50 ms }\n    - { metric: transfer, stat: median, delta: 2 KB }';
  const better = surface(entries, { 'base / lcp': [1500], 'head / lcp': [1400], 'base / transfer': [40960], 'head / transfer': [40960] });
  const { status, stdout } = cli(['compare', 'out', '--comment', 'comment.md'], better);
  assert.equal(status, 0);
  assert.match(stdout, /^🟢 Better than base\.\n[\s\S]*  🟢 LCP 1\.50 s → 1\.40 s\n  same: Transfer 40 KB\n/);
  assert.equal(readFileSync(join(better, 'comment.md'), 'utf8'), '<!-- performance-md:web -->\n### 🚀 Performance improved for web\nLighthouse mobile, 5 runs per side, compared with the base.\n\n**/**\n- 🟢 Largest Contentful Paint (LCP): 1.50 s → 1.40 s\n');
  const mixed = surface(entries, { 'base / lcp': [1500], 'head / lcp': [1400], 'base / transfer': [40960], 'head / transfer': [45056] });
  assert.equal(cli(['compare', 'out', '--comment', 'comment.md'], mixed).status, 1);
  assert.equal(existsSync(join(mixed, 'comment.md')), false);
});

test('limits are checked on head in the metric\'s direction, with exact values', () => {
  const dir = surface('  metrics:\n    - { metric: lcp, stat: median, limit: 1.5 s }\n    - { metric: score, stat: worst, limit: 99 }\n    - { metric: cls, stat: worst, limit: 0.1 }', {
    'head / lcp': [1490, 1502, 1510], 'head / score': [100, 98, 100], 'head / cls': [0, 0.071, 0],
  });
  const { status, stdout } = cli(['compare', 'out'], dir);
  assert.equal(status, 1);
  assert.equal(stdout, `❌ Failed.

Lighthouse mobile, 5 runs per side, median unless noted.

/
  ❌ LCP 1502 ms, past the 1500 ms limit
  ❌ Score (worst) 98, past the 99 limit
  same: CLS (worst) 0.071

❌ past a limit · 🔴 worse than base by more than delta and noise; see measure.metrics in PERFORMANCE.md

`);
});

test('without base results, only limits are checked', () => {
  const dir = surface(lcp('{ metric: lcp, stat: median, limit: 2 s, delta: 1 ms }'), { 'head / lcp': [1000] });
  assert.equal(cli(['compare', 'out'], dir).stdout, 'Within limits.\n\nLighthouse mobile, 5 runs per side, median unless noted.\n\n/\n  all: LCP 1.00 s\n\n');
});

test('a page base does not have is new: its limits count, its deltas cannot', () => {
  const dir = surface(lcp('{ metric: lcp, stat: median, limit: 2 s, delta: 1 ms }'), { 'base / lcp': [1000], 'head / lcp': [1000], 'head /new lcp': [3000] });
  const { status, stdout } = cli(['compare', 'out'], dir);
  assert.equal(status, 1);
  assert.match(stdout, /\/new \(new page\)\n  ❌ LCP 3000 ms, past the 2000 ms limit\n/);
});

test('an override replaces the fields it sets for its target, keeping the others', () => {
  const dir = surface(`  metrics:\n    - { metric: lcp, stat: median, limit: 1 s, delta: 50 ms }\n  overrides:\n    /slow: { metrics: [{ metric: lcp, stat: median, limit: 3 s }, { metric: tbt, stat: max, limit: 100 ms }] }`, {
    'base /slow lcp': [2000], 'head /slow lcp': [2100], 'head /slow tbt': [50],
  });
  const { stdout } = cli(['compare', 'out'], dir);
  assert.match(stdout, /\/slow\n  🔴 LCP 2\.00 s → 2\.10 s\n  same: TBT \(max\) 50 ms\n/);
});

test('results it cannot trust are refused', () => {
  const entry = lcp('{ metric: lcp, stat: median, limit: 2 s }');
  const line = (fields) => JSON.stringify({ name: 'web', tool: 'lighthouse', tool_version: '12.6.1', browser: 'Chrome/155.0.8059.84', side: 'head', target: '/', run: 1, metric: 'lcp', value: 1, unit: 'ms', ...fields });
  const refused = (extra) => cli(['compare', 'out'], surface(entry, {}, { extra })).stderr;
  assert.equal(refused([line({ unit: '' })]), 'performance-md compare: out/results.jsonl:1: lcp is a time value, not ""\n');
  assert.equal(refused([line({ metric: 'cls', unit: 'ms' })]), 'performance-md compare: out/results.jsonl:1: cls is unitless, with unit "", not "ms"\n');
  assert.equal(refused(['{oops']), 'performance-md compare: out/results.jsonl:1: not a JSON object\n');
  assert.equal(refused([line({ side: 'main' })]), 'performance-md compare: out/results.jsonl:1: side is base or head, not main\n');
  assert.match(refused([line({ metric: 'ttfb' })]), /ttfb is not a metric/);
  assert.match(refused([JSON.stringify({ name: 'web' })]), /missing tool/);
  assert.match(refused([line({ side: 'base', browser: 'Chrome/154.0.1.1' }), line({})]), /base was measured with lighthouse 12.6.1 on Chrome\/154.0.1.1 and head with lighthouse 12.6.1 on Chrome\/155.0.8059.84; compare needs both on the same versions/);
  assert.match(refused([line({ tool_version: '12.6.0' }), line({ run: 2 })]), /head was measured with more than one version/);
  assert.match(refused([line({ name: 'docs' })]), /has no results for web/);
  assert.match(cli(['compare', 'out'], surface(lcp('{ metric: tbt, stat: median, limit: 1 s }'), { 'head / lcp': [1] })).stderr, /no tbt results for head \//);
  assert.match(cli(['compare', 'nowhere'], surface(entry, {})).stderr, /nowhere\/results.jsonl doesn't exist; run performance-md measure first/);
});

test('a value in another unit of the same dimension is converted', () => {
  const dir = surface(lcp('{ metric: lcp, stat: median, limit: 2 s }'), {}, {
    extra: [JSON.stringify({ name: 'web', tool: 'lighthouse', tool_version: '12.6.1', browser: 'Chrome/155.0.8059.84', side: 'head', target: '/', run: 1, metric: 'lcp', value: 2.5, unit: 's' })],
  });
  assert.match(cli(['compare', 'out'], dir).stdout, /❌ LCP 2500 ms, past the 2000 ms limit/);
});
