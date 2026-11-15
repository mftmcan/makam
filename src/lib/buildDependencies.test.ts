import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const merge = require('../../vendor/deepmerge/index.cjs');

describe('build dependency security patch', () => {
  it('prevents prototype poisoning from a null-prototype target', () => {
    const source = JSON.parse('{"__proto__":{"polluted":true},"name":"safe"}');
    const result = merge(Object.create(null), source);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(result.name).toBe('safe');
  });

  it('prevents prototype poisoning from enumerable own target keys', () => {
    const target = JSON.parse('{"__proto__":{"polluted":true}}');
    const result = merge(target, { nested: { ok: true } });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.polluted).toBeUndefined();
    expect(result.nested).toEqual({ ok: true });
  });

  it('retains recursive merges, arrays, symbols and custom merge options', () => {
    const symbol = Symbol('setting');
    const first = { nested: { first: 1 }, list: [1], [symbol]: { a: 1 } };
    const second = { nested: { second: 2 }, list: [2], [symbol]: { b: 2 } };
    expect(merge.all([first, second])).toEqual({ nested: { first: 1, second: 2 }, list: [1, 2], [symbol]: { a: 1, b: 2 } });
    expect(merge(first, second, { arrayMerge: (_target: unknown[], source: unknown[]) => source }).list).toEqual([2]);
    expect(first.list).toEqual([1]);
  });

  it('the Rollup consumer resolves the patched package', () => {
    const rollupRequire = createRequire(require.resolve('@rollup/plugin-node-resolve'));
    expect(rollupRequire('deepmerge')).toBe(merge);
  });
});
