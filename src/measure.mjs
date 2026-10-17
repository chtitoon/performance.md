// `performance-md measure <out> --head <path|url> [--base <path|url>] [--all | targets…]`: runs
// each measure tool on every target, `runs` times per side, and writes one line per metric per run
// to <out>/results.jsonl (spec: Results). A path is a build, served following the artifact settings;
// a URL is a running server. With a base, runs alternate base and head so a slow moment on the
// machine hits both alike. Given two builds, only the pages whose files differ are measured:
// identical files give identical results.
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Failure, folder, open, shown } from './open.mjs';
import { serve } from './serve.mjs';
import { MEASURE_DEFAULTS, TOOLS } from './spec.mjs';
import { changedPages, fileFor, pages } from './static-site.mjs';

const RUNNERS = { lighthouse: async () => (await import('./lighthouse.mjs')).lighthouseRunner() };
const isUrl = (location) => /^https?:\/\//i.test(location);

// `runners` maps a tool to a function returning its runner: { start(), run(url, { preset }), stop() },
// where run() resolves to { toolVersion, browser, metrics: { <metric>: { value, unit } }, raw }, raw
// being the tool's own report, and a failed run's error may carry `raw` too.
export async function runMeasure({ file, head, base, all = false } = {}, [out, ...narrowed] = [], cwd = process.cwd(), runners = RUNNERS) {
  const performance = open(file, cwd);
  const { artifact } = performance.data;
  const name = performance.data.name ?? performance.defaultName;
  const measures = [performance.data.measure ?? []].flat();
  if (!measures.length) throw new Failure(`${performance.shown} has no measure`);
  const cleanUrls = artifact?.routes?.clean_urls === true;

  const sides = [['base', base], ['head', head]].filter(([, at]) => at).map(([side, at]) => {
    if (isUrl(at)) return { side, url: at.replace(/\/+$/, '') };
    if (!artifact) throw new Failure(`--${side} ${at} is a build, and serving one needs the artifact settings, which ${performance.shown} doesn't have; give a URL instead`);
    return { side, dist: folder(resolve(cwd, at), at) };
  });
  let targets = targetsOf(performance, sides.at(-1), narrowed, cleanUrls);
  if (!all && !narrowed.length && sides.length === 2 && sides.every((s) => s.dist)) {
    const changed = new Set(changedPages(sides[0].dist, sides[1].dist, { cleanUrls, hashedAssets: artifact.hashed_assets }));
    const count = targets.length;
    targets = targets.filter((target) => changed.has(target));
    console.log(targets.length ? `Measuring the ${targets.length} of ${count} pages that differ from base: ${targets.join(' ')}` : 'No page differs from base: nothing to measure');
  }
  // A page the base build lacks is new: it's measured on head only.
  const has = (side, target) => !side.dist || fileFor(side.dist, target, { cleanUrls }) !== undefined;

  mkdirSync(resolve(cwd, out), { recursive: true });
  const results = join(resolve(cwd, out), 'results.jsonl');
  writeFileSync(results, '');
  if (!targets.length) return 0; // an empty results.jsonl: compare passes it
  let written = 0;
  const servers = [];
  try {
    for (const side of sides.filter((s) => s.dist)) {
      const server = await serve(side.dist, { cleanUrls });
      servers.push(server);
      side.url = server.origin;
    }
    for (const target of targets) {
      for (const side of sides) if (!has(side, target)) console.log(`${side.side} has no page at ${target}: measuring the others only`);
    }
    for (const measure of measures) {
      const { tool } = measure;
      const runs = measure.runs ?? MEASURE_DEFAULTS.runs;
      const preset = measure.preset ?? TOOLS[tool].defaults.preset;
      const runner = await runners[tool]();
      // <out>/<tool>/, emptied first so a previous measurement's reports can't be mistaken for this one's.
      const raws = join(resolve(cwd, out), tool);
      rmSync(raws, { recursive: true, force: true });
      mkdirSync(raws);
      try {
        await runner.start();
      } catch (error) {
        throw new Failure(`${tool} couldn't start: ${error.message}`);
      }
      try {
        for (let run = 1; run <= runs; run++) {
          for (const target of targets) {
            for (const side of sides.filter((s) => has(s, target))) {
              // The tool's raw report is kept next to the results, failed runs too: that's when it's needed.
              const keep = (raw) => raw && writeFileSync(join(raws, `${side.side}${target.replace(/\W/g, '_')}-${run}.json`), JSON.stringify(raw));
              let report;
              try {
                report = await runner.run(`${side.url}${target}`, { preset });
              } catch (error) {
                keep(error.raw);
                throw new Failure(`${tool} failed on ${side.side} ${target}, run ${run}: ${error.message}`);
              }
              keep(report.raw);
              const lines = Object.entries(report.metrics).map(([metric, { value, unit }]) =>
                JSON.stringify({ name, tool, tool_version: report.toolVersion, browser: report.browser, side: side.side, target, run, metric, value, unit }));
              appendFileSync(results, `${lines.join('\n')}\n`);
              written += lines.length;
              const { score, lcp } = report.metrics;
              console.log(`${tool} ${side.side} ${target} run ${run}/${runs}${score ? `: score ${Math.round(score.value)}` : ''}${lcp ? `, LCP ${Math.round(lcp.value)} ms` : ''}`);
            }
          }
        }
      } finally {
        await runner.stop();
      }
    }
  } finally {
    await Promise.all(servers.map((s) => s.close()));
  }
  console.log(`Wrote ${written} results to ${shown(results, cwd)}`);
  return 0;
}

// The targets to measure (spec: lighthouse, Targets): the artifact's pages, whether measuring a
// build or a URL, narrowed by the command line; with no artifact, the command line's, or `/`.
function targetsOf(performance, head, narrowed, cleanUrls) {
  for (const target of narrowed) if (!target.startsWith('/')) throw new Failure(`${target} is not a target: targets are paths starting with /, like /pricing`);
  const { artifact } = performance.data;
  if (!artifact) return narrowed.length ? narrowed : ['/'];
  const dist = head.dist ?? join(performance.dir, artifact.dist);
  if (!existsSync(dist)) {
    if (narrowed.length) return narrowed;
    throw new Failure(`the targets are the artifact's pages, and ${artifact.dist} isn't built; build it or name the targets`);
  }
  const known = pages(dist, { cleanUrls }).map((p) => p.target);
  for (const target of narrowed) if (!known.includes(target)) throw new Failure(`there is no page at ${target}`);
  return narrowed.length ? narrowed : known;
}
