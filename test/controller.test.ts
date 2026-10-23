import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController, type BatchGenerator } from '../src/controller';
import { generateBatch } from '../src/engine';
import type { BatchCard, BatchRequest } from '../src/types';
import { booth, MemoryStorage, rawCatalog, rawFandoms, snapshot, visitor } from './fixtures';

const controllers: AppController[] = [];
const offline = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
class LocalGenerator implements BatchGenerator {
  requests: BatchRequest[] = [];
  async generate(request: BatchRequest) { this.requests.push(request); return generateBatch(request); }
  dispose() {}
}
function setup(count = 16, generator: BatchGenerator = new LocalGenerator()) {
  const storage = new MemoryStorage();
  storage.records.set('snapshot', snapshot(Array.from({ length: count }, (_, i) => booth(`${i}`, [i % 5 + 1]))));
  storage.records.set('visitor', visitor());
  const controller = new AppController(storage, generator, offline); controllers.push(controller);
  return { controller, storage, generator };
}
beforeEach(() => {
  const doc = new EventTarget(); Object.assign(doc, { visibilityState: 'visible' }); vi.stubGlobal('document', doc);
});
afterEach(() => { controllers.forEach(c => c.dispose()); controllers.length = 0; vi.unstubAllGlobals(); });

describe('queue and decision lifecycle', () => {
  it('persists offerings for new decisions, replaces them on a new like, and restores them', async () => {
    const { controller, storage } = setup(2);
    const cached = snapshot([{ ...booth('a'), offerings: ['comic', 'goods'] }, { ...booth('b'), offerings: ['music'] }]);
    storage.records.set('snapshot', cached);
    await controller.start(); await controller.fill();
    const first = controller.getSnapshot().visitor.batches[0][0].booth;
    await controller.decide('pass');
    expect(controller.getSnapshot().visitor.decisions[first.id].offerings).toEqual(first.offerings);
    await controller.toggleSaved({ ...first, offerings: ['artbook'] });
    expect(controller.getSnapshot().visitor.decisions[first.id]).toMatchObject({ kind: 'like', offerings: ['artbook'] });
    await controller.toggleSaved(first);
    expect(controller.getSnapshot().visitor.decisions[first.id].offerings).toEqual(['artbook']);
    const restored = new AppController(storage, new LocalGenerator(), offline); controllers.push(restored);
    await restored.start();
    expect(restored.getSnapshot().visitor.decisions[first.id].offerings).toEqual(['artbook']);
  });
  it('applies a same-version offerings upgrade without changing queued cards or past evidence', async () => {
    const storage = new MemoryStorage();
    const cached = snapshot([booth('a')]); delete cached.offeringsVersion;
    storage.records.set('snapshot', cached);
    const v = visitor();
    v.saved = { a: booth('a') };
    v.decisions = { a: { kind: 'like', at: 1, fandomIds: [1] } };
    v.batches = [[{ booth: booth('queued'), reason: 'learning' }]];
    storage.records.set('visitor', v);
    const raw = rawCatalog();
    const replies = [{ creator_data_version: 1 }, { ...raw, exhibitors: [{ ...raw.exhibitors[0], offerings: ['comic'] }] }, rawFandoms, { creator_data_version: 1 }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift()))) as unknown as typeof fetch;
    const controller = new AppController(storage, new LocalGenerator(), fetcher); controllers.push(controller);
    await controller.start(); await controller.fill();
    const state = controller.getSnapshot();
    expect(state.snapshot?.booths[0].offerings).toEqual(['comic']);
    expect(state.visitor.saved.a.offerings).toEqual(['comic']);
    expect(state.visitor.decisions).toEqual(v.decisions);
    expect(state.visitor.batches[0][0].booth).toEqual(booth('queued'));
  });
  it('starts with two batches, persists before advancing and replenishes after five decisions', async () => {
    const { controller, storage } = setup(); await controller.start(); await controller.fill();
    expect(controller.getSnapshot().visitor.batches.map(b => b.length)).toEqual([5, 5]);
    const first = controller.getSnapshot().visitor.batches[0][0].booth;
    let sawPersistedCurrent = false;
    storage.write.mockImplementation(async (key, raw) => {
      const value = raw as ReturnType<typeof visitor>;
      if (key === 'visitor' && value.decisions[first.id] && value.batches[0]?.[0]?.booth.id === first.id) sawPersistedCurrent = true;
      storage.records.set(key, structuredClone(raw));
    });
    await controller.decide('like');
    expect(sawPersistedCurrent).toBe(true);
    expect(controller.getSnapshot().visitor.saved[first.id]).toEqual(first);
    for (let i = 0; i < 4; i++) await controller.decide('pass');
    await controller.fill();
    const v = controller.getSnapshot().visitor;
    expect(v.batches.map(b => b.length)).toEqual([5, 5]);
    expect(new Set(v.batches.flat().map(c => c.booth.id)).size).toBe(10);
    expect(v.batches.flat().some(c => v.decisions[c.booth.id])).toBe(false);
  });
  it('restores the exact queue, language, saved booth and decisions', async () => {
    const { controller, storage } = setup(); await controller.start(); await controller.fill();
    controller.setLanguage('en'); await controller.decide('like'); await controller.decide('pass');
    const expected = controller.getSnapshot().visitor;
    const restored = new AppController(storage, new LocalGenerator(), offline); controllers.push(restored);
    await restored.start(); await restored.fill();
    expect(restored.getSnapshot().visitor).toEqual(expected);
  });
  it('unsaving preserves learning; saving a queued booth excludes it', async () => {
    const { controller } = setup(); await controller.start(); await controller.fill();
    const queued = controller.getSnapshot().visitor.batches[1][0].booth;
    await controller.toggleSaved(queued); await controller.fill();
    expect(controller.getSnapshot().visitor.batches.flat().some(c => c.booth.id === queued.id)).toBe(false);
    await controller.toggleSaved(queued);
    expect(controller.getSnapshot().visitor.saved[queued.id]).toBeUndefined();
    expect(controller.getSnapshot().visitor.decisions[queued.id].kind).toBe('like');
  });
  it('exhausts a small pool, and a revisit does not repeatedly recycle new passes', async () => {
    const { controller } = setup(2); await controller.start(); await controller.fill();
    await controller.decide('pass'); await controller.decide('pass'); await controller.fill();
    expect(controller.getSnapshot().visitor.batches).toEqual([]);
    await controller.revisit(); await controller.fill();
    expect(controller.getSnapshot().visitor.batches.flat()).toHaveLength(2);
    await controller.decide('pass'); await controller.decide('pass'); await controller.fill();
    expect(controller.getSnapshot().visitor.batches).toEqual([]);
    expect(Object.keys(controller.getSnapshot().visitor.decisions)).toHaveLength(2);
  });
  it('rejects worker results generated before a reset', async () => {
    let resolve!: (cards: BatchCard[]) => void;
    let calls = 0;
    const generator: BatchGenerator = {
      generate: async request => ++calls === 1 ? new Promise<BatchCard[]>(r => { resolve = r; }) : generateBatch(request),
      dispose() {},
    };
    const { controller } = setup(12, generator);
    await controller.start();
    await controller.revisit();
    resolve([{ booth: booth('stale'), reason: 'learning' }]);
    await controller.fill();
    expect(calls).toBe(3);
    expect(controller.getSnapshot().visitor.batches.flat()).toHaveLength(10);
    expect(controller.getSnapshot().visitor.batches.flat().some(c => c.booth.id === 'stale')).toBe(false);
  });
  it('keeps queued cards on catalog update and uses the new snapshot for subsequent generation', async () => {
    const storage = new MemoryStorage();
    storage.records.set('snapshot', snapshot(Array.from({ length: 16 }, (_, i) => booth(String(i)))));
    storage.records.set('visitor', visitor());
    const raw = rawCatalog();
    raw.exhibitors = Array.from({ length: 17 }, (_, i) => ({ ...raw.exhibitors[0], id: String(i), name: `Updated ${i}` }));
    let calls = 0;
    const fetcher = vi.fn(async () => new Response(JSON.stringify([ { creator_data_version: 2 }, raw, rawFandoms, { creator_data_version: 2 } ][calls++])));
    const generator = new LocalGenerator();
    const controller = new AppController(storage, generator, fetcher as typeof fetch); controllers.push(controller);
    await controller.start(); await controller.fill();
    expect(controller.getSnapshot().snapshot?.version).toBe(2);
    expect(controller.getSnapshot().visitor.batches[0][0].booth.name).toContain('Circle');
    for (let i = 0; i < 5; i++) await controller.decide('pass');
    await controller.fill();
    expect(generator.requests.at(-1)?.snapshot.version).toBe(2);
    expect(controller.getSnapshot().visitor.batches[1].every(c => c.booth.name.startsWith('Updated'))).toBe(true);
  });
  it('handles first-load failures without fabricating a catalog', async () => {
    const controller = new AppController(new MemoryStorage(), new LocalGenerator(), offline); controllers.push(controller);
    await controller.start();
    expect(controller.getSnapshot().snapshot).toBeUndefined();
    expect(controller.getSnapshot().loading).toBe(false);
    expect(controller.getSnapshot().error).toContain('offline');
  });
});
