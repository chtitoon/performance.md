import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixtures, folder, root } from './helpers.mjs';

const cli = (args, cwd = root) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, 'bin/performance-md.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status, stdout, stderr };
};
const file = (name, extra = '') => `---\nversion: "1.0"\n${name ? `name: ${name}\n` : ''}measure: { tool: lighthouse }\n${extra}---\n`;

test('lint finds the nearest PERFORMANCE.md upwards and exits 0 when it is valid', () => {
  const { status, stdout } = cli(['lint'], join(fixtures, 'site/dist/blog'));
  assert.equal(status, 0);
  assert.equal(stdout, '../../PERFORMANCE.md: OK, needs version 1.0\n'.replace('../../', join(fixtures, 'site') + '/'));
});

test('lint exits 1 on an error, printing file:line', () => {
  const dir = folder({ 'PERFORMANCE.md': file('', 'x-ok: 1\nbogus: 1\n') });
  const { status, stderr } = cli(['lint'], dir);
  assert.equal(status, 1);
  assert.equal(stderr, 'PERFORMANCE.md:5: error: bogus: unknown key (known: version, name, artifact, measure, surfaces, extends)\nPERFORMANCE.md: 1 error\n');
});

test('lint --file and --strict', () => {
  const dir = folder({ 'apps/web/PERFORMANCE.md': file('web') });
  assert.equal(cli(['lint', '--file', 'apps/web/PERFORMANCE.md'], dir).status, 0);
  assert.equal(cli(['lint', '--strict', '--file', 'apps/web/PERFORMANCE.md'], dir).status, 1);
  assert.match(cli(['lint', '--file', 'nope.md'], dir).stderr, /nope.md doesn't exist/);
  assert.match(cli(['lint'], folder({})).stderr, /no PERFORMANCE.md here or in any folder above/);
});

test('lint --all checks every file below and that names are unique', () => {
  const dir = folder({
    'apps/web/PERFORMANCE.md': file(),
    'apps/docs/PERFORMANCE.md': file('web'),
    'apps/api/PERFORMANCE.md': file('api'),
    'node_modules/x/PERFORMANCE.md': 'not even front matter',
    '.git/PERFORMANCE.md': 'nor this',
  });
  const { status, stdout, stderr } = cli(['lint', '--all'], dir);
  assert.equal(status, 1);
  assert.equal(stdout, 'apps/api/PERFORMANCE.md: OK, needs version 1.0\napps/docs/PERFORMANCE.md: OK, needs version 1.0\n');
  assert.equal(stderr, 'apps/web/PERFORMANCE.md: error: name web is already used by apps/docs/PERFORMANCE.md; names are unique across a repository\napps/web/PERFORMANCE.md: 1 error\n');
  assert.equal(cli(['lint', '--all'], folder({})).status, 1);
});

test('usage errors exit 2', () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['--help']).status, 0);
  assert.equal(cli(['frobnicate']).status, 2);
  assert.equal(cli(['lint', '--nope']).status, 2);
  assert.equal(cli(['lint', '--all', '--file', 'x']).status, 2);
  assert.equal(cli(['compare']).status, 2);
  assert.equal(cli(['compare', 'a', 'b']).status, 2);
});
