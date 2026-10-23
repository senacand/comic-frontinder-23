import type { BatchCard, BatchRequest, Booth, Decision, InterestProfile, Snapshot } from './types';

export const COOLDOWN = 72 * 60 * 60 * 1000;
export const unique = (ids: number[]) => [...new Set(ids)];

export function buildProfile(decisions: Record<string, Decision>, known: Set<number>, generic: Set<number> = new Set()): InterestProfile {
  const profile: InterestProfile = {};
  for (const decision of Object.values(decisions)) {
    const ids = unique(decision.fandomIds).filter(id => known.has(id));
    const hasSpecific = ids.some(id => !generic.has(id));
    for (const id of ids) {
      const item = profile[id] ??= { positive: 0, negative: 0, evidence: 0, interest: 0, confidence: 0 };
      // A mixed booth's reaction says much less about its broad category.
      const evidence = (generic.has(id) && hasSpecific ? 0.25 : 1) / ids.length;
      if (decision.kind === 'like') item.positive += evidence;
      else item.negative += 0.2 * evidence;
      item.evidence += evidence;
    }
  }
  for (const item of Object.values(profile)) {
    item.interest = (item.positive - item.negative) / (1 + item.positive + item.negative);
    item.confidence = item.evidence / (1 + item.evidence);
  }
  return profile;
}

export function catalogProfile(snapshot: Snapshot, decisions: Record<string, Decision>) {
  const generic = new Set(snapshot.fandoms.filter(f => f.kind === 'generic_tag').map(f => f.id));
  const profile = buildProfile(decisions, new Set(snapshot.fandoms.map(f => f.id)), generic);
  const frequency = new Map<number, number>();
  for (const booth of snapshot.booths) {
    for (const id of unique(booth.fandomIds)) {
      if (generic.has(id)) frequency.set(id, (frequency.get(id) ?? 0) + 1);
    }
  }
  // A ubiquitous category is less informative, even after an interest is established.
  // Keep at least half its weight so genuine broad-category preferences still matter.
  const prevalence = (id: number) => (frequency.get(id) ?? 0) / Math.max(1, snapshot.booths.length);
  const weight = (id: number) => generic.has(id) ? 1 - 0.5 * prevalence(id) : 1;
  for (const [key, item] of Object.entries(profile)) {
    const id = Number(key);
    if (generic.has(id)) {
      // Require 1–3 full likes' worth of evidence, according to catalog share.
      // This affects positive affinity, never stored feedback or negative signals.
      const requiredPositive = 1 + 2 * prevalence(id);
      if (item.interest > 0 && item.positive + 1e-9 < requiredPositive) item.interest = 0;
    }
    item.interest *= weight(id);
  }
  return { profile, weight };
}

export function affinity(booth: Booth, profile: InterestProfile): number {
  return booth.fandomIds.length
    ? booth.fandomIds.reduce((sum, id) => sum + (profile[id]?.interest ?? 0), 0) / booth.fandomIds.length
    : 0;
}

export function recommendations(snapshot: Snapshot, decisions: Record<string, Decision>) {
  const { profile } = catalogProfile(snapshot, decisions);
  return snapshot.booths.map(booth => ({
    booth, score: affinity(booth, profile),
    matching: booth.fandomIds.filter(id => (profile[id]?.interest ?? 0) > 0)
      .sort((a, b) => profile[b].interest - profile[a].interest),
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.booth.id.localeCompare(b.booth.id));
}

// Stable pseudorandomness makes restored queues and tests reproducible.
export function noise(seed: number, key: string): number {
  let hash = seed | 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

export function generateBatch(request: BatchRequest): BatchCard[] {
  const { snapshot, decisions, now, revisit, seed, sequence } = request;
  const { profile, weight } = catalogProfile(snapshot, decisions);
  const excluded = new Set(request.excluded);
  let candidates = snapshot.booths.filter(booth => {
    if (excluded.has(booth.id)) return false;
    const decision = decisions[booth.id];
    return !decision || (decision.kind === 'pass' && ((revisit && (!request.revisitIds || request.revisitIds.includes(booth.id))) || now - decision.at >= COOLDOWN));
  });
  const coverage = new Map<number, number>();
  const cover = (booth: Booth) => booth.fandomIds.forEach(id => coverage.set(id, (coverage.get(id) ?? 0) + 1));
  request.queued.forEach(cover);
  const hasPositive = Object.values(profile).some(f => f.interest > 0);
  const slots: BatchCard['reason'][] = hasPositive
    ? ['interest', 'learning', 'interest', 'learning', 'random']
    : ['learning', 'learning', 'learning', 'learning', 'random'];
  const result: BatchCard[] = [];
  for (let slot = 0; slot < 5 && candidates.length; slot++) {
    // This precedence also applies to the random slot.
    const unseen = candidates.filter(b => !decisions[b.id]);
    const pool = unseen.length ? unseen : candidates;
    let reason = slots[slot];
    const jitter = (b: Booth) => noise(seed, `${sequence}:${slot}:${b.id}`);
    const learning = (b: Booth) => b.fandomIds.length
      ? b.fandomIds.reduce((sum, id) => sum + weight(id) * (1 - (profile[id]?.confidence ?? 0)) / (1 + (coverage.get(id) ?? 0)), 0) / b.fandomIds.length
      : 0;
    if (reason === 'interest' && !pool.some(b => affinity(b, profile) > 0)) reason = 'learning';
    if (reason === 'learning' && !pool.some(b => learning(b) > 0)) reason = 'random';
    const score = (b: Booth) => {
      if (reason === 'random') return jitter(b);
      if (reason === 'learning') return learning(b);
      const chosenFandoms = new Set(result.flatMap(c => c.booth.fandomIds));
      const overlap = b.fandomIds.length ? b.fandomIds.reduce((sum, id) => sum + (chosenFandoms.has(id) ? weight(id) : 0), 0) / b.fandomIds.length : 0;
      return affinity(b, profile) - 0.15 * overlap + jitter(b) * 0.0001;
    };
    pool.sort((a, b) => {
      const delta = score(b) - score(a);
      if (Math.abs(delta) > 1e-10) return delta;
      if (reason === 'learning' && a.fandomIds.length !== b.fandomIds.length) return a.fandomIds.length - b.fandomIds.length;
      return jitter(b) - jitter(a) || a.id.localeCompare(b.id);
    });
    const booth = pool[0];
    result.push({ booth, reason }); cover(booth);
    candidates = candidates.filter(b => b.id !== booth.id);
  }
  return result;
}
