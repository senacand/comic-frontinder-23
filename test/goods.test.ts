import { describe, expect, it } from 'vitest';
import { buildGoodsProfile, goodsAdjustedAffinity, normalizeOfferings } from '../src/goods';
import { generateBatch, recommendations } from '../src/engine';
import type { Decision } from '../src/types';
import { booth, snapshot } from './fixtures';

const offeringBooth = (id: string, offerings: string[], fandoms = [1]) => ({ ...booth(id, fandoms), offerings });
const decision = (kind: 'like' | 'pass', offerings?: string[], fandomIds = [1]): Decision => ({ kind, offerings, fandomIds, at: 1 });

describe('goods preferences', () => {
  it('normalizes structured offering strings without merging different media', () => {
    expect(normalizeOfferings([' Comic ', 'comic', 'Handmade Crafts', 'handmade-crafts', '', null, 1, 'photobook_cosplay']))
      .toEqual(['comic', 'handmade_crafts', 'photobook_cosplay']);
    expect(normalizeOfferings(undefined)).toEqual([]);
  });

  it('divides evidence, uses gentle passes, and keeps confidence separate', () => {
    const s = snapshot([offeringBooth('a', ['comic', 'artbook']), booth('b')]);
    const { profile } = buildGoodsProfile(s, { a: decision('like', ['comic', 'artbook', 'comic']), b: decision('pass', ['comic', 'artbook']) });
    expect(profile.comic.positive).toBe(0.5);
    expect(profile.comic.negative).toBe(0.05);
    expect(profile.comic.evidence).toBe(1);
    expect(profile.comic.confidence).toBe(0.5);
    expect(profile.comic.interest).toBeCloseTo(0.55 * 0.45 / 1.55);
    expect(profile.music).toBeUndefined();
  });

  it('reduces ubiquitous categories according to current catalog prevalence', () => {
    const booths = Array.from({ length: 10 }, (_, i) => offeringBooth(String(i), i === 0 ? ['goods', 'music'] : ['goods']));
    const decisions = { a: decision('like', ['goods', 'music']) };
    const { profile, weight } = buildGoodsProfile(snapshot(booths), decisions);
    expect(weight('goods')).toBeCloseTo(0.1);
    expect(weight('music')).toBeCloseTo(0.91);
    expect(profile.music.interest).toBeGreaterThan(profile.goods.interest);
    const changed = buildGoodsProfile(snapshot(booths.map(b => ({ ...b, offerings: ['music'] }))), decisions);
    expect(changed.profile.music.interest).toBeLessThan(profile.music.interest);
  });

  it('replaces decisions and does not infer goods from old fandom-only feedback', () => {
    const s = snapshot([offeringBooth('a', ['comic', 'music'])]);
    const decisions = { a: decision('like', ['comic']), legacy: decision('like') };
    decisions.a = decision('pass', ['music']);
    const { profile } = buildGoodsProfile(s, decisions);
    expect(profile.comic).toBeUndefined();
    expect(profile.music.positive).toBe(0);
    expect(profile.music.negative).toBe(0.1);
    expect(buildGoodsProfile(s, { legacy: decision('like') }).profile).toEqual({});
  });

  it('adjusts equal fandom matches without admitting booths on goods interest alone', () => {
    const s = snapshot([offeringBooth('a', ['comic']), offeringBooth('z', ['music']), offeringBooth('none', ['music'], [2])]);
    const decisions = { liked: decision('like', ['music']) };
    const ranked = recommendations(s, decisions);
    expect(ranked.map(r => r.booth.id)).toEqual(['z', 'a']);
    expect(ranked[0].matchingGoods).toEqual(['music']);
    expect(ranked[1].matchingGoods).toEqual([]);
    expect(recommendations(s, { liked: decision('like', ['music'], []) })).toEqual([]);
    const { profile } = buildGoodsProfile(s, decisions);
    expect(goodsAdjustedAffinity(0, s.booths[0], profile)).toBe(0);
    expect(goodsAdjustedAffinity(0.5, s.booths[1], profile)).toBeLessThanOrEqual(0.625);
    expect(recommendations(snapshot(s.booths.map(b => ({ ...b, offerings: ['comic'] }))), decisions).map(r => r.booth.id)).toEqual(['a', 'z']);
  });

  it('uses goods in interest slots while retaining learning and random slots', () => {
    const s = snapshot(Array.from({ length: 12 }, (_, i) => offeringBooth(String(i), i === 11 ? ['music'] : ['comic'])));
    const request = { snapshot: s, decisions: { liked: decision('like', ['music']) }, queued: [], excluded: [], seed: 42, sequence: 0, now: 1000, revisit: false };
    const cards = generateBatch(request);
    expect(cards.map(c => c.reason)).toEqual(['interest', 'learning', 'interest', 'learning', 'random']);
    let preferred = 0, baseline = 0;
    for (let seed = 0; seed < 512; seed++) {
      if (generateBatch({ ...request, seed })[0].booth.id === '11') preferred++;
      if (generateBatch({ ...request, seed, decisions: { liked: decision('like') } })[0].booth.id === '11') baseline++;
    }
    expect(preferred).toBeGreaterThan(baseline);
    expect(new Set(cards.map(c => c.booth.id)).size).toBe(5);
    expect(generateBatch(request)).toEqual(cards);
  });

  it('uses queued goods coverage when learning otherwise equally uncertain fandoms', () => {
    const s = snapshot([offeringBooth('a', ['comic']), offeringBooth('b', ['music'])]);
    const cards = generateBatch({ snapshot: s, decisions: {}, queued: [offeringBooth('queued', ['comic'], [])], excluded: [], seed: 42, sequence: 0, now: 1000, revisit: false });
    expect(cards[0].reason).toBe('learning');
    expect(cards[0].booth.id).toBe('b');
  });
});
