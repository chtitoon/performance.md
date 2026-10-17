import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from '../src/stats.mjs';

test('median, with an even number of runs the mean of the two middle values', () => {
  assert.equal(stat('median', [3, 1, 2], 'lower'), 2);
  assert.equal(stat('median', [4, 1, 3, 2], 'lower'), 2.5);
});

test('mean, min, max', () => {
  assert.deepEqual(['mean', 'min', 'max'].map((s) => stat(s, [1, 2, 6], 'lower')), [3, 1, 6]);
});

test('worst is the worst run in the metric\'s direction', () => {
  assert.equal(stat('worst', [0, 0.071, 0], 'lower'), 0.071); // CLS
  assert.equal(stat('worst', [100, 97, 99], 'higher'), 97); // score
});

test('p<N> is nearest rank: the value at rank ⌈N/100 × runs⌉ in ascending order', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(stat('p95', twenty, 'lower'), 19);
  assert.equal(stat('p50', twenty, 'lower'), 10);
  assert.equal(stat('p95', [5, 1, 3, 2, 4], 'lower'), 5); // too few runs: the maximum, as lint warns
  assert.equal(stat('p99.9', twenty, 'lower'), 20);
});
