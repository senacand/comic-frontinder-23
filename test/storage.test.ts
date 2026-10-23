import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { BrowserStorage, reconcileSaved, restoreVisitor } from '../src/storage';
import { booth, snapshot, visitor } from './fixtures';

describe('browser persistence', () => {
  it('restores snapshots and visitor progress from IndexedDB', async () => {
    const storage = new BrowserStorage();
    const v = visitor(); v.language = 'en'; v.batches = [[{ booth: booth('a'), reason: 'learning' }]];
    await storage.write('snapshot', snapshot()); await storage.write('visitor', v);
    const restored = new BrowserStorage();
    expect(await restored.read('snapshot')).toEqual(snapshot());
    expect(restoreVisitor(await restored.read('visitor'))).toEqual(v);
  });
  it('falls back to session memory when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      const storage = new BrowserStorage();
      await storage.write('snapshot', snapshot());
      expect(await storage.read('snapshot')).toEqual(snapshot());
    } finally { vi.unstubAllGlobals(); }
  });
  it('handles quota failures without losing current session state', async () => {
    const storage = new BrowserStorage();
    await storage.read('snapshot');
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try {
      await storage.write('snapshot', snapshot([], 900));
      expect(await storage.read('snapshot')).toEqual(snapshot([], 900));
    } finally { spy.mockRestore(); }
  });
  it('updates saved metadata but keeps removed records and current queued cards', () => {
    const v = visitor(); v.saved = { a: booth('a'), removed: booth('removed') };
    v.batches = [[{ booth: booth('a'), reason: 'learning' }]];
    const fresh = { ...booth('a'), name: 'Updated circle' };
    const result = reconcileSaved(v, snapshot([fresh]));
    expect(result.saved.a.name).toBe('Updated circle');
    expect(result.saved.removed).toEqual(v.saved.removed);
    expect(result.batches[0][0].booth.name).toBe('Circle a');
  });
  it('rejects invalid visitor state and removes duplicate queued IDs', () => {
    expect(restoreVisitor({ schema: 300 }).schema).toBe(1);
    const v = visitor(); const card = { booth: booth('a'), reason: 'learning' as const };
    v.batches = [[card], [card]];
    expect(restoreVisitor(v).batches).toHaveLength(1);
  });
  it('does not restore a card whose new pass was persisted before advancement', () => {
    const v = visitor();
    v.decisions.a = { kind: 'pass', at: 200, fandomIds: [1] };
    v.batches = [[{ booth: booth('a'), reason: 'learning', preparedAt: 100 }]];
    expect(restoreVisitor(v).batches).toEqual([]);
  });
  it('preserves revisited cards even when preparation shares the old decision timestamp', () => {
    const v = visitor();
    v.decisions.a = { kind: 'pass', at: 100, fandomIds: [1] };
    v.batches = [[{ booth: booth('a'), reason: 'learning', preparedAt: 100, previousDecisionAt: 100 }]];
    expect(restoreVisitor(v).batches.flat()).toHaveLength(1);
  });
});
