import { describe, expect, it } from 'vitest';
import { affinity, buildProfile, COOLDOWN, generateBatch, recommendations } from '../src/engine';
import type { BatchRequest, Decision } from '../src/types';
import { booth, snapshot } from './fixtures';

const decision = (kind: 'like' | 'pass', fandomIds: number[], at = 1000): Decision => ({ kind, fandomIds, at });
const request = (patch: Partial<BatchRequest> = {}): BatchRequest => ({ snapshot: snapshot(Array.from({ length: 20 }, (_, i) => booth(String(i), [i % 5 + 1]))),
  decisions: {}, queued: [], excluded: [], seed: 42, sequence: 0, now: 1000 + COOLDOWN, revisit: false, ...patch });

describe('interest evidence', () => {
  it('keeps unknown distinct from negative and confidence distinct from interest', () => {
    const profile = buildProfile({ a: decision('pass', [1, 2, 2, 999]) }, new Set([1, 2, 3]));
    expect(profile[3]).toBeUndefined();
    expect(profile[1].negative).toBeCloseTo(.1);
    expect(profile[1].interest).toBeCloseTo(-.1 / 1.1);
    expect(profile[1].confidence).toBeCloseTo(.5 / 1.5);
    expect(affinity(booth('empty', []), profile)).toBe(0);
  });
  it('divides likes and replaces prior evidence by exhibitor ID', () => {
    const decisions = { a: decision('pass', [1]) };
    decisions.a = decision('like', [1, 2]);
    const profile = buildProfile(decisions, new Set([1, 2]));
    expect(profile[1].positive).toBe(.5);
    expect(profile[1].negative).toBe(0);
    expect(profile[1].evidence).toBe(.5);
  });
  it('a divided pass does not erase strong positive preferences', () => {
    const profile = buildProfile({ a: decision('like', [1]), b: decision('pass', [1, 2, 3]) }, new Set([1, 2, 3]));
    expect(profile[1].interest).toBeGreaterThan(0);
    expect(profile[2].interest).toBeLessThan(0);
  });
});

describe('discovery batches', () => {
  it('allocates two interest, two learning, one random, deterministically', () => {
    const input = request({ decisions: { liked: decision('like', [1, 2, 3, 4, 5]) } });
    const cards = generateBatch(input);
    expect(cards.map(c => c.reason)).toEqual(['interest', 'learning', 'interest', 'learning', 'random']);
    expect(generateBatch(input)).toEqual(cards);
    expect(new Set(cards.map(c => c.booth.id)).size).toBe(5);
  });
  it('starts with learning and accounts for queued coverage', () => {
    const input = request({ snapshot: snapshot([booth('a', [1]), booth('b', [2]), booth('broad', [1, 2])]), queued: [booth('queued', [1])] });
    const result = generateBatch(input);
    expect(result[0].booth.id).toBe('b');
    expect(result.every(c => c.reason !== 'interest')).toBe(true);
  });
  it('breaks equal learning value toward clearer single-fandom evidence', () => {
    const result = generateBatch(request({ snapshot: snapshot([booth('single', [1]), booth('broad', [2, 3, 4])]) }));
    expect(result[0].booth.id).toBe('single');
  });
  it('prioritizes unseen over strongly matching cooled-down passes', () => {
    const result = generateBatch(request({ snapshot: snapshot([booth('passed'), booth('unseen', [2])]),
      decisions: { liked: decision('like', [1]), passed: decision('pass', [1]) } }));
    expect(result.map(c => c.booth.id)).toEqual(['unseen', 'passed']);
  });
  it('honors cooldown boundary, likes, queued exclusions and explicit bypass', () => {
    const base = request({ snapshot: snapshot([booth('pass'), booth('like'), booth('queue')]), decisions: { pass: decision('pass', [1]), like: decision('like', [1]) }, excluded: ['queue'] });
    expect(generateBatch({ ...base, now: 1000 + COOLDOWN - 1 })).toEqual([]);
    expect(generateBatch(base).map(c => c.booth.id)).toEqual(['pass']);
    expect(generateBatch({ ...base, now: 1001, revisit: true }).map(c => c.booth.id)).toEqual(['pass']);
  });
  it('uses overlap penalty to diversify interest picks', () => {
    const input = request({ snapshot: snapshot([booth('a', [1]), booth('b', [1]), booth('c', [2]), booth('d', [3]), booth('e', [4]), booth('f', [5])]),
      decisions: { l1: decision('like', [1]), l2: decision('like', [2]) } });
    const interestPicks = generateBatch(input).filter(c => c.reason === 'interest');
    expect(interestPicks).toHaveLength(2);
    expect(interestPicks[0].booth.fandomIds).not.toEqual(interestPicks[1].booth.fandomIds);
  });
  it('supports unknown-fandom booths and partial final batches', () => {
    const cards = generateBatch(request({ snapshot: snapshot([booth('unknown', [])]) }));
    expect(cards).toHaveLength(1);
    expect(cards[0].reason).toBe('random');
  });
});

describe('recommendations', () => {
  it('includes liked and passed booths, excludes nonpositive matches, and uses stable ties', () => {
    const s = snapshot([booth('b'), booth('a'), booth('negative', [2]), booth('unknown', [])]);
    const decisions = { a: decision('like', [1]), b: decision('pass', [1]), neg: decision('pass', [2]) };
    const results = recommendations(s, decisions);
    expect(results.map(r => r.booth.id)).toEqual(['a', 'b']);
    expect(results[0].matching).toEqual([1]);
    expect(recommendations(s, {})).toEqual([]);
  });
});

describe('coverage experiment', () => {
  it('measures coverage and confidence at 10/20/30 choices against affinity-only selection', () => {
    // A large familiar fandom traps affinity-only ranking; smaller fandoms still have catalogs.
    const booths = [
      ...Array.from({ length: 60 }, (_, i) => booth(`familiar-${i}`, [1])),
      ...Array.from({ length: 11 }, (_, i) => Array.from({ length: 4 }, (_, j) => booth(`new-${i}-${j}`, [i + 2]))).flat(),
    ];
    const s = snapshot(booths);
    function simulate(active: boolean) {
      const decisions: Record<string, Decision> = { seed: decision('like', [1]) };
      const stats: { after: number; coverage: number; meanConfidence: number }[] = [];
      let queue: ReturnType<typeof generateBatch> = [], sequence = 0;
      for (let count = 1; count <= 30; count++) {
        while (queue.length <= 5) {
          if (active) queue.push(...generateBatch(request({ snapshot: s, decisions, queued: queue.map(c => c.booth), excluded: queue.map(c => c.booth.id), sequence: sequence++ })));
          else {
            const excluded = new Set([...Object.keys(decisions), ...queue.map(c => c.booth.id)]);
            queue.push(...recommendations(s, decisions).filter(c => !excluded.has(c.booth.id)).slice(0, 5).map(c => ({ booth: c.booth, reason: 'interest' as const })));
          }
        }
        const card = queue.shift()!;
        decisions[card.booth.id] = decision(card.booth.fandomIds[0] % 2 ? 'like' : 'pass', card.booth.fandomIds);
        if ([10, 20, 30].includes(count)) {
          const profile = buildProfile(decisions, new Set(s.fandoms.map(f => f.id)));
          stats.push({ after: count, coverage: Object.keys(profile).length,
            meanConfidence: s.fandoms.reduce((sum, f) => sum + (profile[f.id]?.confidence ?? 0), 0) / s.fandoms.length });
        }
      }
      return stats;
    }
    const active = simulate(true), affinityOnly = simulate(false);
    console.table(active.map((row, i) => ({ ...row, affinityOnlyCoverage: affinityOnly[i].coverage, affinityOnlyConfidence: affinityOnly[i].meanConfidence })));
    active.forEach((row, i) => {
      expect(row.coverage).toBeGreaterThan(affinityOnly[i].coverage);
      expect(row.meanConfidence).toBeGreaterThan(affinityOnly[i].meanConfidence);
    });
  });
});
