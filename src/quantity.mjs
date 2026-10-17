// Quantities: a number, an optional space and a unit (`175 KB`, `2.5 s`, `2%`, `0.1`).
// Values are kept in one base unit per dimension (B, ms, %) so limits and results compare directly.

const UNITS = {
  B: { dimension: 'bytes', factor: 1 },
  KB: { dimension: 'bytes', factor: 1024 },
  MB: { dimension: 'bytes', factor: 1024 * 1024 },
  ms: { dimension: 'time', factor: 1 },
  s: { dimension: 'time', factor: 1000 },
  '%': { dimension: 'percent', factor: 1 },
  '': { dimension: 'unitless', factor: 1 },
};

export const UNITS_OF = {
  bytes: 'B, KB or MB',
  time: 'ms or s',
  percent: '%',
  unitless: 'no unit',
};

export const DIMENSION_NAMES = { bytes: 'a size', time: 'a time', percent: 'a percentage', unitless: 'unitless' };

// Returns { value, dimension } in base units, or undefined if `input` isn't a quantity.
// A YAML number is unitless: `limit: 2500` on a time is an error, not milliseconds.
export function parseQuantity(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? { value: input, dimension: 'unitless' } : undefined;
  if (typeof input !== 'string') return undefined;
  const match = input.match(/^(\d+(?:\.\d+)?) ?(B|KB|MB|ms|s|%)?$/);
  if (!match) return undefined;
  const unit = UNITS[match[2] ?? ''];
  return { value: Number(match[1]) * unit.factor, dimension: unit.dimension };
}
