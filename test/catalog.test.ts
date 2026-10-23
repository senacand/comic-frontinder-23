import { describe, expect, it, vi } from 'vitest';
import { CatalogClient, parseSnapshot, validSnapshot } from '../src/catalog';
import { MemoryStorage, rawCatalog, rawFandoms, snapshot } from './fixtures';
function responses(...values: unknown[]) {
  return vi.fn(async () => {
    const value = values.shift();
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), { status: 200 });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}
const manifest = (version: number) => ({ creator_data_version: version, current_version: 999 });

describe('catalog validation and atomic updates', () => {
  it('binds native browser fetch to its global receiver', async () => {
    const reply = responses(manifest(2), rawCatalog(), rawFandoms, manifest(2));
    const browserFetch = vi.fn(function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return reply(...args);
    });
    vi.stubGlobal('fetch', browserFetch);
    try {
      const client = new CatalogClient(new MemoryStorage());
      expect((await client.refresh()).version).toBe(2);
      expect(browserFetch).toHaveBeenCalledTimes(4);
    } finally { vi.unstubAllGlobals(); }
  });
  it('requires actual galleries, deduplicates fandoms and rejects unsafe URLs', () => {
    const raw = rawCatalog();
    raw.exhibitors.push({ ...raw.exhibitors[0], id: 'thumbnail', assets: { ...raw.exhibitors[0].assets, gallery: [] } });
    raw.exhibitors.push({ ...raw.exhibitors[0], id: 'unsafe', assets: { ...raw.exhibitors[0].assets, gallery: ['javascript:alert(1)'] } });
    const result = parseSnapshot(raw, rawFandoms, 2);
    expect(result.booths).toHaveLength(1);
    expect(result.booths[0].fandomIds).toEqual([1]);
    expect(result.fandoms[0].kind).toBe('generic_tag');
    expect(validSnapshot(result)).toBe(true);
    expect(validSnapshot({ version: 1 })).toBe(false);
    expect(() => parseSnapshot({}, rawFandoms, 1)).toThrow();
  });
  it('uses cached data immediately and skips unchanged downloads', async () => {
    const storage = new MemoryStorage(); storage.records.set('snapshot', snapshot());
    const fetcher = responses(manifest(1));
    const client = new CatalogClient(storage, fetcher);
    expect((await client.cached())?.version).toBe(1);
    expect((await client.refresh()).version).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.write).not.toHaveBeenCalled();
  });
  it('redownloads legacy snapshots missing fandom kinds without touching visitor data', async () => {
    const storage = new MemoryStorage();
    const old = snapshot();
    storage.records.set('snapshot', { ...old, fandoms: old.fandoms.map(({ id, name }) => ({ id, name })) });
    storage.records.set('visitor', { saved: ['keep'], decisions: { a: 'keep' } });
    const client = new CatalogClient(storage, responses(manifest(1), rawCatalog(), rawFandoms, manifest(1)));
    expect(await client.cached()).toBeUndefined();
    expect((await client.refresh()).fandoms[0].kind).toBe('generic_tag');
    expect(storage.records.get('visitor')).toEqual({ saved: ['keep'], decisions: { a: 'keep' } });
  });
  it('deduplicates requests and writes catalog/fandoms/version as one record', async () => {
    const storage = new MemoryStorage();
    const fetcher = responses(manifest(2), rawCatalog(), rawFandoms, manifest(2));
    const client = new CatalogClient(storage, fetcher);
    const [a, b] = await Promise.all([client.refresh(), client.refresh()]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(storage.write).toHaveBeenCalledExactlyOnceWith('snapshot', a);
    expect(fetcher.mock.calls[1][0]).toContain('?v=2');
  });
  it('retries manifest races without committing the mixed snapshot', async () => {
    const storage = new MemoryStorage();
    const client = new CatalogClient(storage, responses(manifest(2), rawCatalog('old'), rawFandoms, manifest(3), manifest(3), rawCatalog('new'), rawFandoms, manifest(3)));
    expect((await client.refresh()).booths[0].id).toBe('new');
    expect(storage.write).toHaveBeenCalledTimes(1);
  });
  it('keeps valid cache after interrupted downloads or malformed payloads', async () => {
    for (const payload of [new Error('network'), {}]) {
      const storage = new MemoryStorage(); storage.records.set('snapshot', snapshot());
      const client = new CatalogClient(storage, responses(manifest(2), payload, rawFandoms));
      await client.cached();
      await expect(client.refresh()).rejects.toThrow();
      expect(storage.records.get('snapshot')).toEqual(snapshot());
      expect(storage.write).not.toHaveBeenCalled();
    }
  });
  it('rejects invalid versions and HTTP failures', async () => {
    await expect(new CatalogClient(new MemoryStorage(), responses({ current_version: 1 })).refresh()).rejects.toThrow('version');
    const fetcher = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new CatalogClient(new MemoryStorage(), fetcher).refresh()).rejects.toThrow('503');
  });
  it('works when the browser does not support AbortSignal.timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new Error('unsupported'); });
    try {
      const client = new CatalogClient(new MemoryStorage(), responses(manifest(2), rawCatalog(), rawFandoms, manifest(2)));
      expect((await client.refresh()).version).toBe(2);
      expect(timeout).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });
  it('identifies the failing endpoint and original network error', async () => {
    const client = new CatalogClient(new MemoryStorage(), responses(new Error('Failed to fetch')));
    await expect(client.refresh()).rejects.toThrow('last-updated.json: Failed to fetch');
  });
});
