import { describe, expect, it } from 'vitest';
import { affinity, buildProfile, catalogProfile, COOLDOWN, generateBatch, recommendations } from '../src/engine';
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

describe('generic fandom tags', () => {
  const catalog = () => {
    const s = snapshot([
      ...Array.from({ length: 30 }, (_, i) => booth(`original-${i}`, [1])),
      booth('mixed', [1, 2]), booth('specific', [2]), booth('other', [3]),
    ]);
    s.fandoms[0] = { id: 1, name: 'Original', kind: 'generic_tag' };
    return s;
  };
  it('does not infer Original affinity from a few mixed-fandom likes', () => {
    const decisions = { a: decision('like', [1, 2]), b: decision('like', [1, 2]), c: decision('like', [1, 2]) };
    const { profile } = catalogProfile(catalog(), decisions);
    expect(profile[1].positive).toBeCloseTo(3 * .25 / 2);
    expect(profile[1].interest).toBe(0);
    expect(profile[1].confidence).toBeGreaterThan(0);
    expect(profile[2].interest).toBeGreaterThan(0);
    const result = recommendations(catalog(), decisions);
    expect(result.map(r => r.booth.id)).toEqual(['specific', 'mixed']);
    expect(result.every(r => !r.matching.includes(1))).toBe(true);
  });
  it('allows established Original preferences while reducing common-tag dominance', () => {
    const decisions = { a: decision('like', [1]), b: decision('like', [1]), c: decision('like', [2]), d: decision('like', [1]) };
    const { profile } = catalogProfile(catalog(), decisions);
    expect(profile[1].interest).toBeGreaterThan(0);
    expect(profile[1].interest).toBeLessThan(2 / 3);
    expect(profile[2].interest).toBe(.5);
    const result = recommendations(catalog(), decisions);
    expect(result[0].booth.id).toBe('specific');
    expect(result.some(r => r.booth.id === 'original-0' && r.matching.includes(1))).toBe(true);
    const cards = generateBatch(request({ snapshot: catalog(), decisions }));
    expect(cards.some(c => c.reason === 'interest' && c.booth.fandomIds.includes(1))).toBe(true);
  });
  it('requires distinct booth evidence and preserves weak generic negatives', () => {
    const decisions = { a: decision('like', [1]) };
    decisions.a = decision('like', [1]);
    expect(catalogProfile(catalog(), decisions).profile[1].interest).toBe(0);
    const mixedPass = catalogProfile(catalog(), { a: decision('pass', [1, 2]) }).profile;
    expect(mixedPass[1].negative).toBeCloseTo(.025);
    expect(mixedPass[1].interest).toBeLessThan(0);
    expect(mixedPass[2].negative).toBeCloseTo(.1);
  });
  it('can establish generic interest from enough mixed evidence without generic-only booths', () => {
    const decisions = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i), decision('like', [1, 2])]));
    expect(catalogProfile(catalog(), decisions).profile[1].positive).toBe(3);
    expect(catalogProfile(catalog(), decisions).profile[1].interest).toBeGreaterThan(0);
  });
  it('uses registry kinds rather than a hardcoded Original name or ID', () => {
    const s = catalog();
    s.fandoms[0].kind = 'franchise';
    s.fandoms[2] = { id: 3, name: 'Anime', kind: 'generic_tag' };
    const { profile } = catalogProfile(s, { a: decision('like', [1, 3]) });
    expect(profile[1].interest).toBeGreaterThan(0);
    expect(profile[3].interest).toBe(0);
  });
  it('handles fractional evidence at a prevalence-derived threshold', () => {
    const s = snapshot(Array.from({ length: 12 }, (_, i) => booth(String(i), i < 6 ? [1, 2, 3] : [4])));
    s.fandoms.slice(0, 3).forEach(f => { f.kind = 'generic_tag'; });
    const decisions = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i), decision('like', [1, 2, 3])]));
    expect(catalogProfile(s, decisions).profile[1].interest).toBeGreaterThan(0);
  });
  it('prefers specific unknown fandoms over a common generic tag in learning slots', () => {
    const cards = generateBatch(request({ snapshot: catalog() }));
    expect(cards[0].booth.id).not.toMatch(/^original-/);
    expect(cards[0].booth.fandomIds.some(id => id !== 1)).toBe(true);
  });
  it('still recommends Original when it is the entire catalog and the interest is established', () => {
    const s = catalog(); s.booths = s.booths.filter(b => b.fandomIds.length === 1 && b.fandomIds[0] === 1);
    const decisions = { a: decision('like', [1]), b: decision('like', [1]), c: decision('like', [1]) };
    expect(recommendations(s, decisions)).toHaveLength(30);
    expect(catalogProfile(s, decisions).profile[1].interest).toBeCloseTo(3 / 8);
  });
  it('requires more evidence for a common tag than a rare tag, and recalculates on catalog changes', () => {
    const makeCatalog = (tagged: number, total: number) => {
      const s = snapshot(Array.from({ length: total }, (_, i) => booth(String(i), i < tagged ? [1] : [2])));
      s.fandoms[0].kind = 'generic_tag';
      return s;
    };
    const decisions = { a: decision('like', [1]), b: decision('like', [1]) };
    const rare = makeCatalog(1, 10), common = makeCatalog(8, 10);
    expect(catalogProfile(rare, decisions).profile[1].interest).toBeGreaterThan(0);
    expect(catalogProfile(common, decisions).profile[1].interest).toBe(0);
    expect(catalogProfile(common, { ...decisions, c: decision('like', [1]) }).profile[1].interest).toBeGreaterThan(0);
    expect(catalogProfile(rare, decisions).profile[1].interest).toBeGreaterThan(0);
    expect(Object.keys(decisions)).toHaveLength(2);
  });
  it('uses catalog share rather than the absolute number of booths', () => {
    const makeCatalog = (total: number) => {
      const s = snapshot(Array.from({ length: total }, (_, i) => booth(String(i), i < total / 5 ? [1, 1] : [2])));
      s.fandoms[0].kind = 'generic_tag';
      return s;
    };
    const decisions = { a: decision('like', [1]), b: decision('like', [1]) };
    expect(catalogProfile(makeCatalog(10), decisions).profile[1].interest)
      .toBeCloseTo(catalogProfile(makeCatalog(100), decisions).profile[1].interest);
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
