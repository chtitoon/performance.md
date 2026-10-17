// The stats of a metrics entry (spec: metrics), over one target's runs.
import { percentile } from './spec.mjs';

// `values` are one target's runs of one metric; `better` is the metric's direction.
export function stat(name, values, better) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (name === 'median') return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  if (name === 'mean') return sorted.reduce((sum, v) => sum + v, 0) / n;
  if (name === 'min') return sorted[0];
  if (name === 'max') return sorted[n - 1];
  // The worst run in the metric's direction: a CLS that flips between runs because a font races the
  // first paint still happens to real visitors on some loads.
  if (name === 'worst') return better === 'higher' ? sorted[0] : sorted[n - 1];
  // Nearest rank: the value at rank ⌈N/100 × runs⌉ in ascending order.
  return sorted[Math.ceil((percentile(name) / 100) * n) - 1];
}
