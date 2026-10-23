import type { Booth, Decision, FandomInterest, Snapshot } from './types';

export type GoodsProfile = Record<string, FandomInterest>;

export function normalizeOfferings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string')
    .map(v => v.normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_')).filter(Boolean))] : [];
}

export function buildGoodsProfile(snapshot: Snapshot, decisions: Record<string, Decision>) {
  const frequency = new Map<string, number>();
  for (const booth of snapshot.booths) {
    for (const kind of normalizeOfferings(booth.offerings)) frequency.set(kind, (frequency.get(kind) ?? 0) + 1);
  }
  // Common offerings such as "goods" tell us less than a distinctive medium.
  const weight = (kind: string) => 1 - 0.9 * (frequency.get(kind) ?? 0) / Math.max(1, snapshot.booths.length);
  const profile: GoodsProfile = {};
  for (const decision of Object.values(decisions)) {
    const kinds = normalizeOfferings(decision.offerings).filter(kind => frequency.has(kind));
    for (const kind of kinds) {
      const item = profile[kind] ??= { positive: 0, negative: 0, evidence: 0, interest: 0, confidence: 0 };
      const evidence = 1 / kinds.length;
      if (decision.kind === 'like') item.positive += evidence;
      else item.negative += 0.1 * evidence;
      item.evidence += evidence;
    }
  }
  for (const [kind, item] of Object.entries(profile)) {
    item.interest = weight(kind) * (item.positive - item.negative) / (1 + item.positive + item.negative);
    item.confidence = item.evidence / (1 + item.evidence);
  }
  return { profile, weight };
}

export function goodsAffinity(booth: Booth, profile: GoodsProfile): number {
  const kinds = normalizeOfferings(booth.offerings);
  return kinds.length ? kinds.reduce((sum, kind) => sum + (profile[kind]?.interest ?? 0), 0) / kinds.length : 0;
}

export function goodsAdjustedAffinity(fandomAffinity: number, booth: Booth, profile: GoodsProfile): number {
  // A bounded secondary adjustment: goods never create or erase a fandom match.
  return fandomAffinity * (1 + 0.25 * goodsAffinity(booth, profile));
}
