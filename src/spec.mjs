// What spec.md defines, as data: the version this CLI supports, the metrics, stats, artifact types
// and tools. Code elsewhere reads these tables rather than repeating names, so adding a metric or a
// budget key to the spec means adding it here (and to schema.json).

// The format version this CLI implements: version 1, up to this minor.
export const SUPPORTED = { major: 1, minor: 0 };

// Every metric, whichever tool measures it (spec: Metrics).
export const METRICS = {
  score: { dimension: 'unitless', better: 'higher', range: [0, 100], meaning: 'Lighthouse performance score' },
  fcp: { dimension: 'time', better: 'lower', meaning: 'First Contentful Paint' },
  lcp: { dimension: 'time', better: 'lower', meaning: 'Largest Contentful Paint' },
  tbt: { dimension: 'time', better: 'lower', meaning: 'Total Blocking Time' },
  cls: { dimension: 'unitless', better: 'lower', meaning: 'Cumulative Layout Shift' },
  transfer: { dimension: 'bytes', better: 'lower', meaning: 'bytes over the network, as transferred' },
  latency: { dimension: 'time', better: 'lower', meaning: 'time from request to complete response' },
  error_rate: { dimension: 'percent', better: 'lower', range: [0, 100], meaning: 'share of requests that failed' },
};

// `p95` → 95; anything that isn't a percentile → undefined.
export const percentile = (stat) => (/^p\d+(\.\d+)?$/.test(stat) ? Number(stat.slice(1)) : undefined);

// With fewer runs than this, `p<N>` is the maximum (nearest rank lands on the last run).
export const runsForPercentile = (n) => Math.ceil(100 / (100 - n));

export const ARTIFACT_TYPES = {
  'static-site': {
    budgets: ['total', 'html', 'css', 'js', 'fonts', 'images', 'image_max'], // all sizes
    rules: ['image_formats', 'image_dimensions', 'origins'],
    // Settings with a default, which `lint --strict` wants written. `hashed_assets` defaults to none,
    // which has no written form, so it isn't required.
    defaults: { 'routes.clean_urls': false, fonts: 'unicode-range' },
  },
};

export const TOOLS = {
  lighthouse: {
    // The one Lighthouse version this CLI runs: scores shift between versions, so upgrading is a
    // deliberate change to the CLI (spec: Tools).
    version: '12.6.1',
    emits: ['score', 'fcp', 'lcp', 'tbt', 'cls', 'transfer'],
    defaults: { preset: 'mobile' },
  },
};

// Defaults every `measure` entry has, whatever its tool.
export const MEASURE_DEFAULTS = { runs: 5, noise: '0%' };
