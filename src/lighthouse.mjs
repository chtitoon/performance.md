// The lighthouse tool (spec: Tools). Lighthouse is an optional dependency, loaded only here, so
// lint, check and compare never install a browser. One Chrome serves every run, and only
// the performance category runs: about 5 s a run instead of 10 with `lhci collect`, with the same
// results. Lighthouse's default waits stay: shorter ones can stop recording before a late font swap
// shifts the layout.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Failure } from './open.mjs';
import { TOOLS } from './spec.mjs';

const VERSION = TOOLS.lighthouse.version;
const INSTALL = `npm install --no-save lighthouse@${VERSION}`;

// Each metric's value in a Lighthouse report, in the spec's base units.
const METRICS = {
  // null when Lighthouse couldn't score the page, which must not read as 0.
  score: { unit: '', read: (lhr) => (typeof lhr.categories.performance?.score === 'number' ? lhr.categories.performance.score * 100 : undefined) },
  fcp: { unit: 'ms', audit: 'first-contentful-paint' },
  lcp: { unit: 'ms', audit: 'largest-contentful-paint' },
  tbt: { unit: 'ms', audit: 'total-blocking-time' },
  cls: { unit: '', audit: 'cumulative-layout-shift' },
  transfer: { unit: 'B', audit: 'total-byte-weight' },
};

// `HeadlessChrome/141.0.7390.54` → `Chrome/141.0.7390.54`. Read from Chrome's own version endpoint,
// not the user agent, which hides the build (`Chrome/141.0.0.0`): two builds would look the same and
// compare would let them be compared.
export const browserOf = (product) => `Chrome/${product?.match(/(?:Headless)?Chrome\/([\d.]+)/)?.[1] ?? 'unknown'}`;

// What one Lighthouse report says: { toolVersion, metrics: { lcp: { value, unit }, … } }.
// A report with a runtime error, or without a metric, is a failed run rather than a missing number.
export function readReport(lhr) {
  if (lhr.runtimeError) throw new Failure(`Lighthouse couldn't load ${lhr.requestedUrl}: ${lhr.runtimeError.code} ${lhr.runtimeError.message ?? ''}`.trim());
  const metrics = {};
  for (const [metric, { unit, audit, read }] of Object.entries(METRICS)) {
    const value = read ? read(lhr) : lhr.audits[audit]?.numericValue;
    if (typeof value !== 'number' || Number.isNaN(value)) throw new Failure(`Lighthouse reported no ${metric} for ${lhr.requestedUrl}`);
    metrics[metric] = { value, unit };
  }
  return { toolVersion: lhr.lighthouseVersion, metrics };
}

// Refuses any Lighthouse but the pinned one: its scores would differ from what the limits were set on.
export function checkVersion(found) {
  if (found !== VERSION) throw new Failure(`measure runs lighthouse ${VERSION}, but ${found} is installed: ${INSTALL}`);
}

// Loads Lighthouse and chrome-launcher (a dependency of Lighthouse, so found through it).
async function load() {
  let entry;
  try {
    entry = fileURLToPath(import.meta.resolve('lighthouse'));
  } catch {
    throw new Failure(`measure needs Lighthouse, an optional dependency: ${INSTALL}`);
  }
  // Lighthouse's own folder: the nearest package.json named lighthouse above its entry point.
  const manifest = (dir) => (existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : {});
  let dir = dirname(entry);
  while (manifest(dir).name !== 'lighthouse') dir = dirname(dir);
  checkVersion(manifest(dir).version);
  const lighthouse = (await import(pathToFileURL(entry))).default;
  const desktop = (await import(pathToFileURL(join(dir, 'core/config/desktop-config.js')))).default;
  const chromeLauncher = await import(pathToFileURL(createRequire(join(dir, 'package.json')).resolve('chrome-launcher')));
  return { lighthouse, desktop, chromeLauncher };
}

// The runner `measure` drives: start(), run(url, { preset }) per run, stop().
export async function lighthouseRunner() {
  const { lighthouse, desktop, chromeLauncher } = await load();
  let chrome;
  let browser;
  return {
    async start() {
      chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
      browser = browserOf((await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json()).Browser);
    },
    async run(url, { preset }) {
      const flags = {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        skipAudits: ['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot'],
      };
      const { lhr } = await lighthouse(url, flags, preset === 'desktop' ? desktop : undefined);
      try {
        return { ...readReport(lhr), browser, raw: lhr };
      } catch (error) {
        error.raw = lhr;
        throw error;
      }
    },
    async stop() {
      await chrome?.kill();
    },
  };
}
