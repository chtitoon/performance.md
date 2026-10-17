// A small JSON Schema validator for the keywords schema.json uses, so `lint` needs no validator
// dependency. It throws on any keyword it doesn't implement: a typo in schema.json, or a keyword
// added without support here, fails every test instead of quietly checking nothing.
// Errors are { keys, message }, `keys` being the path to the value as map keys and list indexes.
// `errorMessage` (as in ajv-errors) replaces a subschema's errors with one message; `{value}` in it
// is replaced by the value.

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'format', '$defs', 'errorMessage']);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};
const matchesType = (value, type) => typeOf(value) === type || (type === 'number' && typeOf(value) === 'integer');

// Names as someone writing YAML knows them.
const TYPE_NAMES = { object: 'a mapping', array: 'a list', string: 'a string', number: 'a number', integer: 'a whole number', boolean: 'true or false', null: 'empty' };
export const show = (value) => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value));

export function validate(root, data) {
  const resolve = (schema) => {
    if (schema?.$ref === undefined) return schema;
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node?.[key], root);
    if (!target) throw new Error(`schema.json: unresolved $ref ${schema.$ref}`);
    return target;
  };

  const check = (schema, value, keys) => {
    if (schema === true) return [];
    if (schema === false) return [{ keys, message: 'is not allowed' }];
    const errors = schema.$ref === undefined ? checkKeywords(schema, value, keys) : check(resolve(schema), value, keys);
    if (errors.length && schema.errorMessage) return [{ keys, message: schema.errorMessage.replace('{value}', show(value)) }];
    return errors;
  };

  const checkKeywords = (schema, value, keys) => {
    for (const keyword of Object.keys(schema)) {
      if (!KEYWORDS.has(keyword) && !ANNOTATIONS.has(keyword)) throw new Error(`schema.json: keyword "${keyword}" isn't supported by src/schema.mjs`);
    }
    const errors = [];
    const fail = (message, at = keys) => errors.push({ keys: at, message });

    if (schema.type) {
      const types = [schema.type].flat();
      if (!types.some((type) => matchesType(value, type))) {
        fail(`must be ${types.map((t) => TYPE_NAMES[t]).join(' or ')}`);
        return errors; // nothing else means much on the wrong type
      }
    }
    if (schema.enum && !schema.enum.some((option) => option === value)) fail(`${show(value)} is not one of: ${schema.enum.join(', ')}`);
    if ('const' in schema && schema.const !== value) fail(`must be ${show(schema.const)}`);
    if (schema.not && check(schema.not, value, keys).length === 0) fail('is not allowed');

    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(`${show(value)} is not valid`);
      if (schema.minLength !== undefined && value.length < schema.minLength) fail('must not be empty');
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
      if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('has the same item twice');
      if (schema.items !== undefined) value.forEach((item, i) => errors.push(...check(schema.items, item, [...keys, i])));
    }
    if (typeOf(value) === 'object') {
      for (const key of schema.required ?? []) if (!(key in value)) fail(`missing ${key}`);
      for (const [key, item] of Object.entries(value)) {
        const at = [...keys, key];
        if (schema.propertyNames) {
          const nameErrors = check(schema.propertyNames, key, at);
          if (nameErrors.length) {
            errors.push(...nameErrors);
            continue;
          }
        }
        const patterns = Object.entries(schema.patternProperties ?? {}).filter(([pattern]) => new RegExp(pattern, 'u').test(key));
        if (schema.properties && key in schema.properties) errors.push(...check(schema.properties[key], item, at));
        for (const [, subschema] of patterns) errors.push(...check(subschema, item, at));
        if (!(schema.properties && key in schema.properties) && !patterns.length && schema.additionalProperties !== undefined) {
          if (schema.additionalProperties === false) fail(unknownKey(key, Object.keys(schema.properties ?? {})), at);
          else errors.push(...check(schema.additionalProperties, item, at));
        }
      }
    }

    for (const keyword of ['anyOf', 'oneOf']) {
      if (!schema[keyword]) continue;
      const results = schema[keyword].map((option) => check(option, value, keys));
      const passed = results.filter((r) => r.length === 0).length;
      if (keyword === 'oneOf' && passed > 1) fail('matches more than one option');
      if (passed > 0) continue;
      // Options that each require one key read as "needs artifact, measure or both".
      const required = schema[keyword].map((option) => (Object.keys(option).join() === 'required' && option.required.length === 1 ? option.required[0] : undefined));
      if (keyword === 'anyOf' && required.every(Boolean)) {
        fail(`needs ${required.slice(0, -1).join(', ')}, ${required.at(-1)} or ${required.length === 2 ? 'both' : 'several'}`);
        continue;
      }
      // Report the option meant for this kind of value (the list form, the mapping form), if one is.
      const typed = schema[keyword].map(resolve).map((option, i) => [option, results[i]]).filter(([option]) => option.type && [option.type].flat().some((t) => matchesType(value, t)));
      if (typed.length === 1) errors.push(...typed[0][1]);
      else fail('is not valid');
    }
    return errors;
  };

  return check(root, data, []);
}

const KEYWORDS = new Set([
  '$ref', 'type', 'enum', 'const', 'not', 'pattern', 'minLength', 'minimum', 'maximum', 'minItems', 'uniqueItems', 'items',
  'required', 'properties', 'patternProperties', 'additionalProperties', 'propertyNames', 'anyOf', 'oneOf',
]);

function unknownKey(key, known) {
  const close = known.find((k) => distance(k, key) <= Math.max(1, Math.floor(k.length / 4)));
  return close ? `unknown key; did you mean ${close}?` : `unknown key${known.length ? ` (known: ${known.join(', ')})` : ''}`;
}

// Edit distance, for "did you mean".
function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
