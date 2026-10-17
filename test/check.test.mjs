import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixtures, folder, root } from './helpers.mjs';

const cli = (args, cwd = root) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, 'bin/performance-md.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status, stdout, stderr };
};
// A site: its PERFORMANCE.md's artifact settings (YAML lines under `artifact:`) and its built files.
const site = (artifact, dist) => folder({
  'PERFORMANCE.md': `---\nversion: "1.0"\nartifact:\n  type: static-site\n  dist: dist\n  origin: https://example.com\n${artifact}\n---\n`,
  ...Object.fromEntries(Object.entries(dist).map(([path, content]) => [`dist/${path}`, content])),
});

test('check passes the fixture site and --report prints each page\'s sizes', () => {
  const { status, stdout } = cli(['check', '--report'], join(fixtures, 'site'));
  assert.equal(status, 0);
  assert.match(stdout, /│ \/blog\/\s+│ 308\s+│ 446\s+│ 5000\s+│ 156\s+│ 0\s+│ 5910\s+│/);
  assert.match(stdout, /Budgets and rules OK across 4 pages \(largest 5\.8 KB\)\n$/);
});

test('check exits 1 with the page, the overage and the setting it broke', () => {
  const dir = site(
    '  budgets: { total: 1 KB, image_max: 1 KB }\n  rules: { image_formats: [svg, webp], image_dimensions: true, origins: [self, https://cdn.example.com] }\n  overrides:\n    /: { budgets: { total: 2 KB } }',
    {
      'index.html': '<img src="/big.png"><script src="https://cdn.example.com/a.js"></script><script src="https://tracker.example/t.js"></script>',
      'other.html': '<link rel="stylesheet" href="/gone.css">',
      'big.png': 'x'.repeat(1500),
    },
  );
  const { status, stderr } = cli(['check'], dir);
  assert.equal(status, 1);
  assert.equal(stderr, `Budgets or rules broken (see PERFORMANCE.md):
/: big.png is 1.5 KB, over the 1.0 KB cap by 476 B (budgets.image_max)
/: big.png is .png; use svg, webp (rules.image_formats)
/: <img src="/big.png"> has no width and height (rules.image_dimensions)
/: loads https://tracker.example/t.js from another origin (rules.origins)
/other.html: loads /gone.css, which isn't in the build
`);
});

test('an override replaces the file\'s setting for its page only', () => {
  const dir = site('  budgets: { html: 10 B }\n  overrides:\n    /big.html: { budgets: { html: 1 KB } }', { 'big.html': 'x'.repeat(100), 'small.html': 'x'.repeat(20) });
  assert.equal(cli(['check'], dir).stderr, 'Budgets or rules broken (see PERFORMANCE.md):\n/small.html: html is 20 B, over its 10 B budget by 10 B (budgets.html)\n');
  const tighter = site('  budgets: { html: 1 KB }\n  overrides:\n    /big.html: { budgets: { html: 10 B } }', { 'big.html': 'x'.repeat(100) });
  assert.match(cli(['check'], tighter).stderr, /html is 100 B, over its 10 B budget by 90 B \(overrides\["\/big.html"\].budgets.html\)/);
});

test('--dist checks another build, whose pages the overrides must name', () => {
  const dir = site('  budgets: { html: 1 KB }\n  overrides:\n    /a.html: { budgets: { html: 2 KB } }', { 'a.html': 'a' });
  const other = folder({ 'b.html': 'b' });
  assert.match(cli(['check', '--dist', other], dir).stderr, /overrides\["\/a.html"\]: there is no page at \/a.html/);
});

test('check refuses what it cannot check', () => {
  assert.match(cli(['check'], site('  budgets: { html: 1 }', {})).stderr, /error: artifact.budgets.html: 1 has no unit[\s\S]*has errors; see performance-md lint\n$/);
  assert.match(cli(['check'], folder({ 'PERFORMANCE.md': '---\nversion: "1.0"\nmeasure: { tool: lighthouse }\n---\n' })).stderr, /has no artifact to check/);
  const unbuilt = site('  budgets: { html: 1 KB }', {});
  assert.deepEqual([cli(['check'], unbuilt).status, cli(['check'], unbuilt).stderr], [1, "performance-md check: dist doesn't exist or isn't a folder\n"]);
  assert.match(cli(['check'], site('', { 'a.css': '' })).stderr, /dist has no .html pages/);
});

test('with no budgets or rules, check says nothing was checked', () => {
  assert.equal(cli(['check'], site('', { 'index.html': 'hi' })).stdout, 'No budgets or rules in PERFORMANCE.md; nothing checked across 1 pages\n');
});
