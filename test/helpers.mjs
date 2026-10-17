import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const root = new URL('..', import.meta.url).pathname;
export const fixtures = join(root, 'test/fixtures');

// The complete file at the end of spec.md, so the spec's own example always lints.
export const specExample = () => readFileSync(join(root, 'spec.md'), 'utf8').match(/## Example\s+```yaml\n([\s\S]*?)```/)[1];

// The example at the top of README.md, for the same reason.
export const readmeExample = () => readFileSync(join(root, 'README.md'), 'utf8').match(/```markdown\n([\s\S]*?)```/)[1];

// Writes files ({ 'path': 'content' }, undefined content skipped) into a fresh temporary folder and returns its path.
export function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'performance-md-'));
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
