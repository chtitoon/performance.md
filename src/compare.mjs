// `performance-md compare <out> [--comment <file>]`: checks each metrics limit on head and, when base
// results exist, each delta, from <out>/results.jsonl alone (spec: Commands, Results). Prints a
// plain-text report, short enough to read in a job log or on a phone, and writes <file> only when
// something improved and nothing regressed. Ported from Hutch's compare-performance.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Failure, open, shown } from './open.mjs';
import { parseQuantity, UNITS } from './quantity.mjs';
import { MEASURE_DEFAULTS, METRICS, TOOLS } from './spec.mjs';
import { stat } from './stats.mjs';

// Values for people: 1.20 s, 96 ms, 30 KB, 0.071, 100. `exact` keeps milliseconds, so a limit missed
// by 2 ms reads as 1802 ms, not 1.80 s.
function format(value, metric, exact = false) {
  const { dimension } = METRICS[metric];
  if (dimension === 'time') return exact || value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
  if (dimension === 'bytes') return value < 1024 ? `${Math.round(value)} B` : `${(value / 1024).toFixed(exact ? 1 : 0)} KB`;
  if (dimension === 'percent') return `${value.toFixed(2)}%`;
  return metric === 'score' ? `${Math.round(value)}` : value.toFixed(3);
}

export function runCompare({ file, comment } = {}, [out] = [], cwd = process.cwd()) {
  const performance = open(file, cwd);
  const name = performance.data.name ?? performance.defaultName;
  const measures = [performance.data.measure ?? []].flat();
  if (!measures.length) throw new Failure(`${performance.shown} has no measure, so nothing to compare`);
  const path = join(resolve(cwd, out), 'results.jsonl');
  if (!existsSync(path)) throw new Failure(`${shown(path, cwd)} doesn't exist; run performance-md measure first`);
  const results = readResults(path, cwd).filter((r) => r.name === name);
  if (!results.length) throw new Failure(`${shown(path, cwd)} has no results for ${name}`);

  const sections = [];
  const failures = [];
  const gains = [];
  for (const measure of measures) {
    const section = compareTool(measure, results.filter((r) => r.tool === measure.tool), performance.shown);
    sections.push(section.text);
    failures.push(...section.failures);
    gains.push(...section.gains.map((g) => ({ ...g, measure })));
  }

  const hasBase = results.some((r) => r.side === 'base');
  const verdict = failures.length ? '❌ Failed' : gains.length ? '🟢 Better than base' : hasBase ? 'On par with base' : 'Within limits';
  console.log(`${verdict}.\n\n${sections.join('\n')}`);

  if (comment && gains.length && !failures.length) {
    const lines = [`<!-- performance-md:${name} -->`, `### 🚀 ${name} got better`];
    for (const measure of measures) {
      const mine = gains.filter((g) => g.measure === measure);
      if (!mine.length) continue;
      lines.push(`${describe(measure)}, compared with the base.`);
      for (const target of [...new Set(mine.map((g) => g.target))]) {
        lines.push('', `**${target}**`, ...mine.filter((g) => g.target === target).map((g) => `- ${meaningOf(g)}: ${format(g.before, g.metric)} → ${format(g.now, g.metric)}`));
      }
    }
    writeFileSync(resolve(cwd, comment), `${lines.join('\n')}\n`);
  }
  return failures.length ? 1 : 0;
}

// `Largest Contentful Paint (lcp)`, `Lighthouse performance score (score, worst)`: the spec's name
// for readers of the comment, and the file's, so either can be looked up.
const meaningOf = ({ metric, stat }) => {
  const { meaning } = METRICS[metric];
  return `${meaning[0].toUpperCase()}${meaning.slice(1)} (${metric}${stat === 'median' ? '' : `, ${stat}`})`;
};

const describe = (measure) => `${measure.tool === 'lighthouse' ? 'Lighthouse' : measure.tool} ${measure.preset ?? TOOLS[measure.tool].defaults.preset}, ${measure.runs ?? MEASURE_DEFAULTS.runs} runs per side`;

// Reads results.jsonl, refusing a line it can't trust: unknown metric, or a unit that doesn't fit the
// metric (a tool reporting seconds can't pass for one reporting milliseconds). Values come back in
// the metric's base unit.
function readResults(path, cwd) {
  const at = (i) => `${shown(path, cwd)}:${i + 1}`;
  return readFileSync(path, 'utf8').split('\n').flatMap((text, i) => {
    if (!text.trim()) return [];
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      throw new Failure(`${at(i)}: not a JSON object`);
    }
    for (const field of ['name', 'tool', 'tool_version', 'side', 'target', 'run', 'metric', 'value', 'unit']) {
      if (!(field in line)) throw new Failure(`${at(i)}: missing ${field}`);
    }
    const metric = METRICS[line.metric];
    if (!metric) throw new Failure(`${at(i)}: ${line.metric} is not a metric`);
    const unit = UNITS[line.unit];
    if (!unit || unit.dimension !== metric.dimension) {
      throw new Failure(`${at(i)}: ${line.metric} is ${metric.dimension === 'unitless' ? 'unitless, with unit ""' : `a ${metric.dimension} value`}, not "${line.unit}"`);
    }
    if (!['base', 'head'].includes(line.side)) throw new Failure(`${at(i)}: side is base or head, not ${line.side}`);
    if (typeof line.value !== 'number') throw new Failure(`${at(i)}: value must be a number`);
    return [{ ...line, value: line.value * unit.factor }];
  });
}

// One tool's part of the report.
function compareTool(measure, results, file) {
  const { tool } = measure;
  if (!results.length) throw new Failure(`no ${tool} results to compare`);
  checkVersions(tool, results);
  const noise = parseQuantity(measure.noise ?? MEASURE_DEFAULTS.noise).value / 100;
  // values[side][target][metric] = [one per run]
  const values = { base: {}, head: {} };
  for (const r of results) ((values[r.side][r.target] ??= {})[r.metric] ??= []).push(r.value);

  const failures = [];
  const gains = [];
  const blocks = [];
  for (const target of Object.keys(values.head).sort()) {
    const before = values.base[target];
    const now = values.head[target];
    const lines = [];
    const same = [];
    for (const entry of entriesFor(measure, target)) {
      const { metric } = entry;
      const { better } = METRICS[metric];
      if (!now[metric]) throw new Failure(`no ${metric} results for head ${target}`);
      // Named as in the file, so a line points at the entry to look at: `lcp`, `score (worst)`.
      const label = entry.stat === 'median' ? metric : `${metric} (${entry.stat})`;
      const value = stat(entry.stat, now[metric], better);
      const worse = (a, b) => (better === 'higher' ? b - a : a - b); // how much a is worse than b
      const limit = entry.limit === undefined ? undefined : parseQuantity(entry.limit).value;
      const broken = limit !== undefined && worse(value, limit) > 0;

      let change = '';
      let base;
      if (before?.[metric] && entry.delta !== undefined) {
        base = stat(entry.stat, before[metric], better);
        // Worse by more than both the entry's delta and the noise share of the base value.
        const margin = Math.max(parseQuantity(entry.delta).value, noise * Math.abs(base));
        change = worse(value, base) > margin ? 'regressed' : worse(base, value) > margin ? 'improved' : '';
      }
      const shownValue = change ? `${format(base, metric)} → ${format(value, metric)}` : format(value, metric);
      if (broken) {
        lines.push(`  ❌ ${label} ${format(value, metric, true)}, past the ${format(limit, metric, true)} limit`);
        failures.push(`${target} ${metric} limit`);
      } else if (change === 'regressed') lines.push(`  🔴 ${label} ${shownValue}`);
      else if (change === 'improved') lines.push(`  🟢 ${label} ${shownValue}`);
      else same.push(`${label} ${shownValue}`);
      if (change === 'regressed') failures.push(`${target} ${metric} regressed`);
      if (change === 'improved') gains.push({ target, metric, stat: entry.stat, before: base, now: value });
    }
    if (same.length) lines.push(`  ${lines.length ? 'same' : 'all'}: ${same.join(' · ')}`);
    blocks.push(`${target}${before ? '' : Object.keys(values.base).length ? ' (new page)' : ''}`, ...lines, '');
  }

  const sides = Object.keys(values.base).length ? 'base → head, ' : '';
  const legend = failures.length ? [`❌ past a limit · 🔴 worse than base by more than delta and noise; see measure.metrics in ${file}`, ''] : [];
  return { text: [`${describe(measure)}, ${sides}median unless noted.`, '', ...blocks, ...legend].join('\n'), failures, gains };
}

// The file's metrics entries for one target, with the target's override merged in: an override
// entry replaces the fields it sets on the entry with the same metric and stat, or adds an entry.
export function entriesFor(measure, target) {
  const entries = (measure.metrics ?? []).map((e) => ({ ...e }));
  for (const override of measure.overrides?.[target]?.metrics ?? []) {
    const existing = entries.find((e) => e.metric === override.metric && e.stat === override.stat);
    if (existing) Object.assign(existing, override);
    else entries.push({ ...override });
  }
  return entries;
}

// Base and head must come from the same tool and browser versions: scores shift between them.
function checkVersions(tool, results) {
  const versions = (side) => [...new Set(results.filter((r) => r.side === side).map((r) => `${tool} ${r.tool_version} on ${r.browser ?? 'no browser'}`))];
  const [base, head] = [versions('base'), versions('head')];
  for (const [side, list] of [['base', base], ['head', head]]) {
    if (list.length > 1) throw new Failure(`${side} was measured with more than one version: ${list.join(', ')}`);
  }
  if (base.length && base[0] !== head[0]) throw new Failure(`base was measured with ${base[0]} and head with ${head[0]}; compare needs both on the same versions`);
}
