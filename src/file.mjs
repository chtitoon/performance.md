// Finding and reading PERFORMANCE.md: the front matter as data, plus where each value sits in the
// file, so errors can point at a line.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { LineCounter, parseDocument, isMap, isSeq } from 'yaml';

export const FILE_NAME = 'PERFORMANCE.md';

// The nearest PERFORMANCE.md from `from` upwards, or undefined.
export function findFile(from = process.cwd()) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, FILE_NAME))) return join(dir, FILE_NAME);
    if (dirname(dir) === dir) return undefined;
  }
}

// Every PERFORMANCE.md under `root`, skipping dependencies and hidden folders.
export function findAllFiles(root = process.cwd()) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name === FILE_NAME) found.push(join(dir, entry.name));
    }
  };
  walk(resolve(root));
  return found.sort();
}

// Reads a PERFORMANCE.md. Returns { path, dir, data, defaultName, lineOf, errors }: `errors` holds
// problems that stop the front matter from being read at all, each { line, message }.
export function readFile(path) {
  const dir = dirname(resolve(path));
  const result = { path, dir, defaultName: basename(dir), data: undefined, lineOf: () => undefined, errors: [] };
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end === -1) {
    result.errors.push({ line: 1, message: 'no front matter: the file must start with a --- line, and the front matter end with another' });
    return result;
  }
  // The front matter starts on line 2; YAML counts from 1.
  const lineCounter = new LineCounter();
  const doc = parseDocument(lines.slice(1, end).join('\n'), { lineCounter, prettyErrors: false });
  const lineAt = (offset) => lineCounter.linePos(offset).line + 1;
  for (const error of doc.errors) result.errors.push({ line: lineAt(error.pos[0]), message: error.message.split('\n')[0] });
  if (result.errors.length) return result;
  result.data = doc.toJS() ?? {};
  if (typeof result.data !== 'object' || Array.isArray(result.data)) {
    result.errors.push({ line: 2, message: 'the front matter must be a mapping of keys to values' });
    return result;
  }
  result.lineOf = (keys) => {
    const range = locate(doc.contents, keys);
    return range ? lineAt(range[0]) : undefined;
  };
  return result;
}

// The source range of the value at `keys` (a list of map keys and list indexes): the key's own range
// for a map entry, so a block value still points at the line that names it. Stops at the deepest
// node that exists, which is where a missing key belongs.
function locate(node, keys) {
  let range = node?.range;
  for (const key of keys) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (p.key?.value ?? p.key) === key);
      if (!pair) break;
      range = pair.key?.range ?? range;
      node = pair.value;
    } else if (isSeq(node) && node.items[key]) {
      node = node.items[key];
      range = node.range ?? range;
    } else break;
  }
  return range;
}
