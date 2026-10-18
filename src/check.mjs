// `performance check`: every page of the built site against artifact.budgets and artifact.rules.
// No browser and no network: it reads the built files and adds up what each page makes the browser
// download. `--report` prints each page's measured sizes, used to set the budgets.
import { join, resolve } from 'node:path';
import { formatBytes, parseQuantity } from './quantity.mjs';
import { display } from './lint.mjs';
import { Failure, folder, open } from './open.mjs';
import { imageFormat, measurePage, pages } from './static-site.mjs';

const SIZES = ['html', 'css', 'fonts', 'images', 'js', 'total']; // the report's columns, in order

export function runCheck({ file, dist, report = false } = {}, cwd = process.cwd()) {
  const performance = open(file, cwd);
  const { artifact } = performance.data;
  if (!artifact) throw new Failure(`${performance.shown} has no artifact to check`);
  const cleanUrls = artifact.routes?.clean_urls === true;
  const distPath = folder(dist ? resolve(cwd, dist) : join(performance.dir, artifact.dist), dist ?? artifact.dist);
  const site = pages(distPath, { cleanUrls });
  if (!site.length) throw new Failure(`${dist ?? artifact.dist} has no .html pages`);

  const failures = [];
  const overrides = Object.entries(artifact.overrides ?? {}).filter(([target]) => target.startsWith('/'));
  for (const [target] of overrides) {
    if (!site.some((page) => page.target === target)) failures.push(`${display(['overrides', target])}: there is no page at ${target}`);
  }

  const results = site.map(({ target, file: page }) => {
    const measured = measurePage(distPath, page, { origin: artifact.origin, cleanUrls, fonts: artifact.fonts });
    return { target, ...measured, problems: judge(measured, artifact, target) };
  });

  if (report) console.table(Object.fromEntries(results.map(({ target, totals }) => [target, Object.fromEntries(SIZES.map((s) => [s, totals[s]]))])));

  failures.push(...results.flatMap(({ target, problems }) => problems.map((p) => `${target}: ${p}`)));
  if (failures.length) {
    console.error(`Budgets or rules broken (see ${performance.shown}):\n${failures.join('\n')}`);
    return 1;
  }
  const largest = Math.max(...results.map((r) => r.totals.total));
  const checked = Object.keys(artifact.budgets ?? {}).length + Object.keys(artifact.rules ?? {}).length + overrides.length;
  console.log(checked ? `Budgets and rules OK across ${site.length} pages (largest ${formatBytes(largest)})` : `No budgets or rules in ${performance.shown}; nothing checked across ${site.length} pages`);
  return 0;
}

// One page's problems: its budgets and rules, the file's merged with the page's override key by key.
function judge({ totals, images, offsite, missing, undimensioned }, artifact, target) {
  const override = artifact.overrides?.[target] ?? {};
  const settings = (section) => {
    const merged = {};
    for (const [key, value] of Object.entries(artifact[section] ?? {})) merged[key] = { value, source: `${section}.${key}` };
    for (const [key, value] of Object.entries(override[section] ?? {})) merged[key] = { value, source: display(['overrides', target, section, key]) };
    return merged;
  };
  const budgets = settings('budgets');
  const rules = settings('rules');
  const problems = [];

  // A file the page links but the build lacks can't be counted, so the sizes would read low.
  for (const path of missing) problems.push(`loads ${path}, which isn't in the build`);

  for (const size of SIZES) {
    if (!budgets[size]) continue;
    const limit = parseQuantity(budgets[size].value).value;
    if (totals[size] > limit) problems.push(`${size} is ${formatBytes(totals[size])}, over its ${formatBytes(limit)} budget by ${formatBytes(totals[size] - limit)} (${budgets[size].source})`);
  }
  if (budgets.image_max) {
    const cap = parseQuantity(budgets.image_max.value).value;
    for (const { path, bytes } of images) {
      if (bytes > cap) problems.push(`${path} is ${formatBytes(bytes)}, over the ${formatBytes(cap)} cap by ${formatBytes(bytes - cap)} (${budgets.image_max.source})`);
    }
  }

  if (rules.image_formats) {
    const allowed = rules.image_formats.value;
    for (const { path } of images) {
      if (!allowed.includes(imageFormat(path))) problems.push(`${path} is .${imageFormat(path)}; use ${allowed.join(', ')} (${rules.image_formats.source})`);
    }
  }
  if (rules.image_dimensions?.value === true) {
    for (const src of undimensioned) problems.push(`<img src="${src}"> has no width and height (${rules.image_dimensions.source})`);
  }
  if (rules.origins) {
    const allowed = rules.origins.value.map((o) => (o === 'self' ? new URL(artifact.origin).origin : new URL(o).origin));
    for (const url of offsite) if (!allowed.includes(new URL(url).origin)) problems.push(`loads ${url} from another origin (${rules.origins.source})`);
  }
  return [...new Set(problems)];
}
