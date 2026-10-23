import { describe, expect, it } from 'vitest';
import { generateBatch, recommendations } from '../src/engine';
import type { Decision } from '../src/types';
import { booth, snapshot } from './fixtures';

const like = (fandomIds: number[]): Decision => ({ kind: 'like', fandomIds, at: 1 });
const decisions = {
  strong1: like([1]), strong2: like([1]),
  close1: like([2]), close2: like([2, 4]),
  weak: like([3, 5, 6, 7, 8, 9, 10, 11, 12]),
};
const catalog = snapshot([booth('strong', [1]), booth('close', [2]), booth('weak', [3]), booth('unknown', [])]);

describe('selection among similar matches', () => {
  it('varies both cold-start batches between fresh visitors despite one uniquely best learning score', () => {
    const s = snapshot([
      { ...booth('rare-game', [1, 2]), offerings: ['game'] },
      ...Array.from({ length: 15 }, (_, i) => ({ ...booth(`merch${i}`, [i % 10 + 1]), offerings: ['goods'] })),
    ]);
    const firstIds = new Set<string>(), queues = new Set<string>();
    for (let seed = 0; seed < 128; seed++) {
      const request = { snapshot: s, decisions: {}, excluded: [] as string[], queued: [] as typeof s.booths,
        seed, sequence: 0, now: 1000, revisit: false };
      const first = generateBatch(request);
      const second = generateBatch({ ...request, sequence: 1, excluded: first.map(c => c.booth.id), queued: first.map(c => c.booth) });
      expect(first.map(c => c.reason)).toEqual(['learning', 'learning', 'learning', 'learning', 'random']);
      expect(new Set([...first, ...second].map(c => c.booth.id)).size).toBe(10);
      expect(generateBatch(request)).toEqual(first);
      firstIds.add(first[0].booth.id);
      queues.add([...first, ...second].map(c => c.booth.id).join(','));
    }
    expect(firstIds.size).toBeGreaterThan(10);
    expect(queues.size).toBeGreaterThan(100);
  });
  it('varies For You between visitors while keeping clearly weaker matches below the strong tier', () => {
    let strongestFirst = 0;
    for (let seed = 0; seed < 1024; seed++) {
      const results = recommendations(catalog, decisions, seed);
      expect(new Set(results.map(r => r.booth.id))).toEqual(new Set(['strong', 'close', 'weak']));
      expect(results[2].booth.id).toBe('weak');
      if (results[0].booth.id === 'strong') strongestFirst++;
    }
    // Relative scores are 1 and 0.9, weighted to the fourth power (~60:40).
    expect(strongestFirst).toBeGreaterThan(540);
    expect(strongestFirst).toBeLessThan(700);
  });

  it('keeps a visitor order stable across refreshes, catalog reordering, and discovery exclusions', () => {
    const chosen = recommendations(catalog, decisions, 42);
    expect(recommendations(catalog, decisions, 42)).toEqual(chosen);
    expect(recommendations({ ...catalog, booths: [...catalog.booths].reverse() }, decisions, 42)).toEqual(chosen);
    const withHistory = { ...decisions, strong: { kind: 'pass', at: Date.now(), fandomIds: [] } as Decision,
      close: like([]) };
    expect(recommendations(catalog, withHistory, 42)).toEqual(chosen);
    expect(recommendations(catalog, {}, 42)).toEqual([]);
  });

  it('does not reserve fixed first or second positions for equally strong booths', () => {
    const equal = snapshot([booth('a'), booth('b'), booth('c')]);
    const first = new Set<string>(), second = new Set<string>();
    for (let seed = 0; seed < 128; seed++) {
      const ranked = recommendations(equal, decisions, seed);
      first.add(ranked[0].booth.id); second.add(ranked[1].booth.id);
    }
    expect(first.size).toBe(3); expect(second.size).toBe(3);
  });

  it('samples Explore interest slots from close matches and preserves batching constraints', () => {
    const s = snapshot([...catalog.booths, ...Array.from({ length: 8 }, (_, i) => booth(`learn${i}`, [i + 5]))]);
    const first = new Set<string>();
    for (let seed = 0; seed < 128; seed++) {
      const request = { snapshot: s, decisions, excluded: [], queued: [], seed, sequence: 0, now: 1000, revisit: false };
      const cards = generateBatch(request);
      expect(cards).toHaveLength(5);
      expect(cards.map(c => c.reason)).toEqual(['interest', 'learning', 'interest', 'learning', 'random']);
      expect(new Set(cards.map(c => c.booth.id)).size).toBe(5);
      expect(['strong', 'close']).toContain(cards[0].booth.id);
      first.add(cards[0].booth.id);
      expect(generateBatch(request)).toEqual(cards);
    }
    expect(first.size).toBe(2);
  });
});
