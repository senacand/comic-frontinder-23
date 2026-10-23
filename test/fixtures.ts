import type { Booth, Snapshot, Visitor } from '../src/types';
import type { StorageAdapter } from '../src/storage';
import { vi } from 'vitest';

export class MemoryStorage implements StorageAdapter {
  records = new Map<string, unknown>();
  read = async <T>(key: string) => structuredClone(this.records.get(key)) as T | undefined;
  write = vi.fn(async (key: string, value: unknown) => { this.records.set(key, structuredClone(value)); });
}

export function booth(id: string, fandomIds = [1]): Booth {
  return { id, name: `Circle ${id}`, fandomIds, gallery: [`https://example.com/${id}.jpg`], spaces: ['A-01'], days: ['2026-10-31'] };
}
export function snapshot(booths: Booth[] = [booth('a'), booth('b', [2])], version = 1): Snapshot {
  return { version, booths, fandoms: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(id => ({ id, name: `Fandom ${id}`, kind: 'franchise' })) };
}
export function visitor(): Visitor {
  return { schema: 1, seed: 42, sequence: 0, language: 'id', saved: {}, decisions: {}, batches: [], revisit: false };
}
export const rawCatalog = (id = 'a') => ({ schemaVersion: '1.0.0', exhibitors: [{
  id, name: `Circle ${id}`, spaces: [{ code: 'A-01' }], attendanceDates: ['2026-10-31'],
  fandomIds: [1, 1, 999], assets: { thumbnail: 'https://example.com/thumbnail.jpg', gallery: ['https://example.com/catalog.jpg'] },
}] });
export const rawFandoms = { schemaVersion: '1.0.0', fandoms: [{ id: 1, name: 'Original', kind: 'generic_tag' }] };
