import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { validate } from '../src/schema.mjs';
import { root, specExample } from './helpers.mjs';

const schema = JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8'));
const messages = (s, data) => validate(s, data).map((e) => `${e.keys.join('.')}: ${e.message}`);

test('schema.json accepts the spec example', () => {
  assert.deepEqual(validate(schema, parse(specExample().replace(/^---\n|---\n[\s\S]*$/g, ''))), []);
});

test('the validator rejects keywords it does not implement', () => {
  assert.throws(() => validate({ type: 'object', requried: ['a'] }, {}), /keyword "requried"/);
});

test('the validator reports each keyword with a readable message', () => {
  const s = {
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'integer', minimum: 1 },
      b: { enum: ['x', 'y'] },
      c: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^[a-z]+$' } },
      d: { $ref: '#/$defs/d' },
      e: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    },
    patternProperties: { '^x-': true },
    additionalProperties: false,
    $defs: { d: { not: {}, errorMessage: 'no {value}' } },
  };
  assert.deepEqual(messages(s, { a: 1, 'x-anything': {} }), []);
  assert.deepEqual(messages(s, {}), [': missing a']);
  assert.deepEqual(messages(s, { a: 0.5 }), ['a: must be a whole number']);
  assert.deepEqual(messages(s, { a: 0, b: 'z' }), ['a: must be at least 1', 'b: "z" is not one of: x, y']);
  assert.deepEqual(messages(s, { a: 1, c: [] }), ['c: needs at least 1 item']);
  assert.deepEqual(messages(s, { a: 1, c: ['ok', 'ok', 'No'] }), ['c: has the same item twice', 'c.2: "No" is not valid']);
  assert.deepEqual(messages(s, { a: 1, d: 3 }), ['d: no 3']);
  assert.deepEqual(messages(s, { a: 1, e: [1] }), ['e.0: must be a string']);
  assert.deepEqual(messages(s, { a: 1, e: 1 }), ['e: is not valid']);
  assert.deepEqual(messages(s, { a: 1, bb: 1 }), ['bb: unknown key; did you mean b?']);
});

test('anyOf of single required keys reads as "needs a, b or both"', () => {
  assert.deepEqual(messages({ anyOf: [{ required: ['limit'] }, { required: ['delta'] }] }, {}), [': needs limit, delta or both']);
});
