// `performance lint`: checks a PERFORMANCE.md against spec.md. schema.json catches the shape;
// this adds what a schema can't express: units by dimension, which metrics a tool emits, unique
// metric and stat, overrides of targets that exist, and the version the file needs.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { findAllFiles, findFile, readFile, FILE_NAME } from './file.mjs';
import { DIMENSION_NAMES, UNITS_OF, parseQuantity } from './quantity.mjs';
import { validate, show } from './schema.mjs';
import { ARTIFACT_TYPES, MEASURE_DEFAULTS, METRICS, SUPPORTED, TOOLS, percentile, runsForPercentile } from './spec.mjs';
import { pages } from './static-site.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const startsWith = (keys, prefix) => prefix.every((key, i) => keys[i] === key);
const same = (a, b) => a.length === b.length && startsWith(a, b);

// `measure.metrics[1].limit`, `artifact.overrides["/pricing"].total`
export const display = (keys) =>
  keys.map((key) => (typeof key === 'number' ? `[${key}]` : /^[A-Za-z_][\w-]*$/.test(key) ? `.${key}` : `[${show(key)}]`)).join('').replace(/^\./, '');

// Lints one file read by readFile. Returns { name, needs, errors, warnings }, each finding { line, message }.
export function lint(file, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const name = typeof file.data?.name === 'string' ? file.data.name : file.defaultName;
  const result = { name, needs: `${SUPPORTED.major}.${SUPPORTED.minor}`, errors, warnings };
  if (file.errors.length) {
    errors.push(...file.errors);
    return result;
  }
  const { data } = file;
  const add = (list) => (keys, message) => list.push({ keys, line: file.lineOf(keys), message: keys.length ? `${display(keys)}: ${message}` : message });
  const error = add(errors);
  const warn = add(warnings);

  // An unsupported version makes every other finding a guess, so it's the only one.
  if (typeof data.version === 'number') error(['version'], `write it quoted, like version: "1.0"; unquoted, YAML reads 1.10 as the number 1.1`);
  const version = typeof data.version === 'string' && data.version.match(/^(\d+)\.(\d+)$/);
  if (version) {
    const [major, minor] = [Number(version[1]), Number(version[2])];
    const supported = `${SUPPORTED.major}.${SUPPORTED.minor}`;
    if (major !== SUPPORTED.major) error(['version'], `this file needs ${data.version}; this tool supports version ${SUPPORTED.major}, up to ${supported}`);
    else if (minor > SUPPORTED.minor) error(['version'], `this file needs ${data.version}; this tool supports up to ${supported}`);
    if (errors.length) return finish(result);
  }

  const measures = Array.isArray(data.measure) ? data.measure.map((m, i) => [m, ['measure', i]]) : data.measure ? [[data.measure, ['measure']]] : [];
  for (const [measure, at] of measures) {
    if (measure?.tool === 'command') error([...at, 'tool'], 'not supported yet: tool command is reserved for a later version of the format');
  }

  // Schema errors, minus those already reported with a better message, and minus the settings of an
  // unknown artifact type or tool: they'd only repeat that the type is wrong.
  const schemaErrors = validate(schema, data);
  const reported = errors.map((e) => e.keys);
  const wrongKinds = [...reported, ...schemaErrors.map((e) => e.keys)].filter((keys) => ['type', 'tool'].includes(keys.at(-1)) && keys.length <= 3);
  for (const { keys, message } of schemaErrors) {
    if (reported.some((r) => same(r, keys))) continue;
    if (wrongKinds.some((kind) => !same(kind, keys) && startsWith(keys, kind.slice(0, -1)))) continue;
    error(keys, message);
  }

  // Units: every limit is checked against the dimension of what it limits.
  const dimension = (keys, value, wanted, what) => {
    const quantity = parseQuantity(value);
    if (!quantity || quantity.dimension === wanted) return quantity;
    const unit = `${what} is ${DIMENSION_NAMES[wanted]}${wanted === 'unitless' ? '' : `, in ${UNITS_OF[wanted]}`}`;
    if (quantity.dimension === 'unitless') error(keys, `${show(value)} has no unit; ${unit}`);
    else if (wanted === 'unitless') error(keys, `${show(value)} has a unit; ${unit}`);
    else error(keys, `${show(value)} is ${DIMENSION_NAMES[quantity.dimension]}; ${unit}`);
  };

  const artifact = isObject(data.artifact) && ARTIFACT_TYPES[data.artifact.type] ? data.artifact : undefined;
  if (artifact) {
    const type = ARTIFACT_TYPES[artifact.type];
    if (typeof artifact.dist === 'string' && isAbsolute(artifact.dist)) error(['artifact', 'dist'], 'paths in the file are relative to its folder');
    const budgets = [['artifact', 'budgets'], ...Object.keys(isObject(artifact.overrides) ? artifact.overrides : {}).map((t) => ['artifact', 'overrides', t, 'budgets'])];
    for (const at of budgets) {
      const values = at.reduce((node, key) => node?.[key], data);
      if (!isObject(values)) continue;
      for (const [key, value] of Object.entries(values)) if (type.budgets.includes(key)) dimension([...at, key], value, 'bytes', key);
    }
  }

  const tools = new Map();
  for (const [measure, at] of measures) {
    const tool = TOOLS[measure?.tool];
    if (!isObject(measure) || !tool) continue;
    if (tools.has(measure.tool)) error([...at, 'tool'], `${measure.tool} is already measured by ${display(tools.get(measure.tool))}; results are keyed by tool, so each tool appears once`);
    else tools.set(measure.tool, at);
    if ('noise' in measure) dimension([...at, 'noise'], measure.noise, 'percent', 'noise');
    const runs = Number.isInteger(measure.runs) ? measure.runs : MEASURE_DEFAULTS.runs;
    const fileEntries = Array.isArray(measure.metrics) ? measure.metrics : [];
    const lists = [[fileEntries, [...at, 'metrics']]];
    for (const [target, override] of Object.entries(isObject(measure.overrides) ? measure.overrides : {})) {
      if (Array.isArray(override?.metrics)) lists.push([override.metrics, [...at, 'overrides', target, 'metrics']]);
    }
    for (const [list, listAt] of lists) {
      const seen = new Set();
      list.forEach((entry, i) => {
        if (!isObject(entry) || !METRICS[entry.metric]) return;
        const keys = [...listAt, i];
        const metric = METRICS[entry.metric];
        if (!tool.emits.includes(entry.metric)) error([...keys, 'metric'], `${measure.tool} doesn't emit ${entry.metric}; it emits ${tool.emits.join(', ')}`);
        for (const field of ['limit', 'delta']) {
          if (!(field in entry)) continue;
          const quantity = dimension([...keys, field], entry[field], metric.dimension, entry.metric);
          if (quantity && metric.range && quantity.value > metric.range[1]) error([...keys, field], `${entry.metric} goes from ${metric.range[0]} to ${metric.range[1]}`);
        }
        if (typeof entry.stat !== 'string') return;
        const id = `${entry.metric} ${entry.stat}`;
        if (seen.has(id)) error(keys, `${entry.metric} at ${entry.stat} is listed twice; metric and stat together are unique`);
        seen.add(id);
        // An override of an entry the file has would repeat the file's warning.
        const n = percentile(entry.stat);
        const inFile = list !== fileEntries && fileEntries.some((e) => e?.metric === entry.metric && e?.stat === entry.stat);
        if (n !== undefined && runs < runsForPercentile(n) && !inFile) {
          warn([...keys, 'stat'], `${entry.stat} of ${runs} runs is simply the maximum; it needs at least ${runsForPercentile(n)} runs to mean anything`);
        }
      });
    }
  }

  checkTargets(file, artifact, measures, error, warn);
  if (strict) checkStrict(data, file.defaultName, artifact, measures, error);
  return finish(result);
}

// Overrides must name targets that exist. A static site's targets are its pages, so this needs the
// build; without one it's a warning rather than a silent pass.
function checkTargets(file, artifact, measures, error, warn) {
  const overrides = [
    ['artifact', 'overrides', artifact?.overrides],
    ...measures.map(([measure, at]) => [...at, 'overrides', measure?.overrides]),
  ].filter((o) => isObject(o.at(-1)) && Object.keys(o.at(-1)).some((t) => t.startsWith('/')));
  if (!overrides.length) return;
  const dist = typeof artifact?.dist === 'string' ? join(file.dir, artifact.dist) : undefined;
  if (!artifact) {
    for (const o of overrides) warn(o.slice(0, -1), "can't check these targets: with no artifact, targets come from the command line");
    return;
  }
  if (!dist || !existsSync(dist) || !statSync(dist).isDirectory()) {
    for (const o of overrides) warn(o.slice(0, -1), `can't check these targets until the site is built: ${artifact.dist} doesn't exist`);
    return;
  }
  const targets = new Set(pages(dist, { cleanUrls: artifact.routes?.clean_urls === true }).map((p) => p.target));
  for (const o of overrides) {
    const at = o.slice(0, -1);
    for (const target of Object.keys(o.at(-1))) {
      if (target.startsWith('/') && !targets.has(target)) error([...at, target], `${artifact.dist.replace(/\/?$/, '/')} has no page at ${target}`);
    }
  }
}

// `--strict`: every field that has a default is written, so the file says everything it relies on.
function checkStrict(data, defaultName, artifact, measures, error) {
  const missing = (node, path) => path.split('.').reduce((n, key) => (isObject(n) ? n[key] : undefined), node) === undefined;
  if (!('name' in data)) error([], `--strict: write name (default: ${defaultName})`);
  if (artifact) {
    for (const [path, value] of Object.entries(ARTIFACT_TYPES[artifact.type].defaults)) {
      if (missing(artifact, path)) error(['artifact'], `--strict: write ${path} (default: ${value})`);
    }
  }
  for (const [measure, at] of measures) {
    if (!isObject(measure) || !TOOLS[measure.tool]) continue;
    for (const [path, value] of Object.entries({ ...MEASURE_DEFAULTS, ...TOOLS[measure.tool].defaults })) {
      if (missing(measure, path)) error(at, `--strict: write ${path} (default: ${value})`);
    }
  }
}

function finish(result) {
  const byLine = (a, b) => (a.line ?? 0) - (b.line ?? 0);
  result.errors = result.errors.sort(byLine).map(({ line, message }) => ({ line, message }));
  result.warnings = result.warnings.sort(byLine).map(({ line, message }) => ({ line, message }));
  return result;
}

// The command. Returns the exit code: 1 on any error.
export function runLint({ strict = false, all = false, file } = {}, cwd = process.cwd()) {
  let paths;
  if (all) {
    paths = findAllFiles(cwd);
    if (!paths.length) return fail(`no ${FILE_NAME} under ${cwd}`);
  } else {
    const path = file ?? findFile(cwd);
    if (!path) return fail(`no ${FILE_NAME} here or in any folder above; give one with --file`);
    if (!existsSync(path)) return fail(`${path} doesn't exist`);
    paths = [path];
  }

  const shown = (path) => (relative(cwd, path).startsWith('..') ? path : relative(cwd, path) || path);
  const results = paths.map((path) => ({ path, shown: shown(path), file: readFile(path) })).map((r) => ({ ...r, ...lint(r.file, { strict }) }));
  if (all) {
    const byName = new Map();
    for (const r of results) {
      const line = typeof r.file.data?.name === 'string' ? r.file.lineOf(['name']) : undefined;
      if (byName.has(r.name)) r.errors.push({ line, message: `name ${r.name} is already used by ${byName.get(r.name)}; names are unique across a repository` });
      else byName.set(r.name, r.shown);
    }
  }

  for (const r of results) {
    const at = (line) => (line ? `${r.shown}:${line}` : r.shown);
    for (const { line, message } of r.errors) console.error(`${at(line)}: error: ${message}`);
    for (const { line, message } of r.warnings) console.error(`${at(line)}: warning: ${message}`);
    const warnings = r.warnings.length ? `, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}` : '';
    if (r.errors.length) console.error(`${r.shown}: ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}${warnings}`);
    else console.log(`${r.shown}: OK, needs version ${r.needs}${warnings}`);
  }
  return results.some((r) => r.errors.length) ? 1 : 0;
}

function fail(message) {
  console.error(`performance lint: ${message}`);
  return 1;
}
