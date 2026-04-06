import { describe, it, expect } from 'vitest';
import { shuffle, pickRandom } from './utils';

describe('shuffle', () => {
  it('returns a new array with the same elements', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result).toHaveLength(input.length);
    expect(result.sort()).toEqual(input.sort());
  });

  it('does not mutate the original array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(shuffle([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(shuffle([42])).toEqual([42]);
  });

  it('eventually produces a different order', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let sawDifferent = false;
    for (let i = 0; i < 20; i++) {
      const result = shuffle(input);
      if (result.some((val, idx) => val !== input[idx])) {
        sawDifferent = true;
        break;
      }
    }
    expect(sawDifferent).toBe(true);
  });
});

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c'];
    const result = pickRandom(arr);
    expect(arr).toContain(result);
  });

  it('returns the only element for a single-element array', () => {
    expect(pickRandom([99])).toBe(99);
  });

  it('eventually picks different elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      seen.add(pickRandom(arr));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
