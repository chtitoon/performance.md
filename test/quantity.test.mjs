import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity } from '../src/quantity.mjs';

test('quantities are parsed into base units', () => {
  assert.deepEqual(parseQuantity('175 KB'), { value: 175 * 1024, dimension: 'bytes' });
  assert.deepEqual(parseQuantity('1 MB'), { value: 1024 * 1024, dimension: 'bytes' });
  assert.deepEqual(parseQuantity('0 B'), { value: 0, dimension: 'bytes' });
  assert.deepEqual(parseQuantity('2.5 s'), { value: 2500, dimension: 'time' });
  assert.deepEqual(parseQuantity('50ms'), { value: 50, dimension: 'time' });
  assert.deepEqual(parseQuantity('2%'), { value: 2, dimension: 'percent' });
  assert.deepEqual(parseQuantity(0.1), { value: 0.1, dimension: 'unitless' });
  assert.deepEqual(parseQuantity('90'), { value: 90, dimension: 'unitless' });
});

test('anything else is not a quantity', () => {
  for (const input of ['175 kb', '175  KB', 'KB', '-1 B', '1e3 ms', '', '2 sec', null, undefined, true, -1, NaN]) {
    assert.equal(parseQuantity(input), undefined, String(input));
  }
});
