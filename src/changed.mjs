// `performance-md changed <base> <head>`: the targets whose artifact differs between two builds, one
// per line, so a pull request measures only what it changed: identical files give identical results.
import { resolve } from 'node:path';
import { Failure, folder, open } from './open.mjs';
import { changedPages } from './static-site.mjs';

export function runChanged({ file } = {}, [base, head] = [], cwd = process.cwd()) {
  const performance = open(file, cwd);
  const { artifact } = performance.data;
  if (!artifact) throw new Failure(`${performance.shown} has no artifact, so there are no builds to compare`);
  const options = { cleanUrls: artifact.routes?.clean_urls === true, hashedAssets: artifact.hashed_assets };
  for (const target of changedPages(folder(resolve(cwd, base), base), folder(resolve(cwd, head), head), options)) console.log(target);
  return 0;
}
