// Opening the PERFORMANCE.md a command works on. A file that doesn't lint is refused: checking what
// the spec rejects would check something other than what the file says.
import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { findFile, readFile, FILE_NAME } from './file.mjs';
import { lint } from './lint.mjs';

// A failure the command reports as `performance-md <command>: <message>`, exiting 1.
export class Failure extends Error {}

// A path for messages: relative to `cwd` when it's below it.
export const shown = (path, cwd = process.cwd()) => (relative(cwd, path).startsWith('..') ? path : relative(cwd, path) || path);

export function open(file, cwd = process.cwd()) {
  const path = file ?? findFile(cwd);
  if (!path) throw new Failure(`no ${FILE_NAME} here or in any folder above; give one with --file`);
  if (!existsSync(path)) throw new Failure(`${path} doesn't exist`);
  const read = readFile(path);
  const { errors } = lint(read);
  if (errors.length) {
    for (const { line, message } of errors) console.error(`${shown(path, cwd)}${line ? `:${line}` : ''}: error: ${message}`);
    throw new Failure(`${shown(path, cwd)} has errors; see performance-md lint`);
  }
  return { ...read, shown: shown(path, cwd) };
}

// A folder given on the command line or in the file, which must exist.
export function folder(path, as) {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Failure(`${as} doesn't exist or isn't a folder`);
  return path;
}
