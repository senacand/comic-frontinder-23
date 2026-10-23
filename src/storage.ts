import type { Snapshot, Visitor } from './types';
import { validBooth } from './catalog';

export interface StorageAdapter {
  read<T>(key: 'snapshot' | 'visitor'): Promise<T | undefined>;
  write(key: 'snapshot' | 'visitor', value: unknown): Promise<void>;
}

// One transaction replaces the whole snapshot, never independent catalog/fandom records.
export class BrowserStorage implements StorageAdapter {
  private db?: Promise<IDBDatabase>;
  private memory = new Map<string, unknown>();
  private unavailable = false;

  private open() {
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cf23-circle-crush', 1);
      const timeout = setTimeout(() => { this.unavailable = true; reject(new Error('Storage unavailable')); }, 2500);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (this.unavailable) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); this.unavailable = true; };
        resolve(request.result);
      };
      request.onerror = () => { clearTimeout(timeout); reject(request.error); };
      request.onblocked = () => { clearTimeout(timeout); reject(new Error('Storage blocked')); };
    });
  }

  async read<T>(key: 'snapshot' | 'visitor'): Promise<T | undefined> {
    if (this.memory.has(key)) return structuredClone(this.memory.get(key)) as T;
    if (this.unavailable) return;
    try {
      const db = await this.open();
      const value = await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction('records', 'readonly');
        const request = tx.objectStore('records').get(key);
        tx.oncomplete = () => resolve(request.result as T | undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (value !== undefined) this.memory.set(key, value);
      return structuredClone(value);
    } catch { this.unavailable = true; return; }
  }

  async write(key: 'snapshot' | 'visitor', value: unknown) {
    const copy = structuredClone(value);
    this.memory.set(key, copy);
    if (this.unavailable) return;
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').put(copy, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch { this.unavailable = true; }
  }
}

export function newVisitor(): Visitor {
  return { schema: 1, seed: crypto.getRandomValues(new Uint32Array(1))[0], sequence: 0,
    language: 'id', decisions: {}, saved: {}, batches: [], revisit: false };
}

export function restoreVisitor(raw: unknown): Visitor {
  if (!raw || typeof raw !== 'object') return newVisitor();
  const v = raw as Visitor;
  if (v.schema !== 1 || !Number.isFinite(v.seed) || !Number.isInteger(v.sequence) || v.sequence < 0 ||
    !['id', 'en'].includes(v.language) || !v.decisions || typeof v.decisions !== 'object' || Array.isArray(v.decisions) ||
    !v.saved || typeof v.saved !== 'object' || Array.isArray(v.saved) || !Array.isArray(v.batches)) return newVisitor();
  try {
    for (const d of Object.values(v.decisions)) {
      if (!['like', 'pass'].includes(d.kind) || !Number.isFinite(d.at) || !Array.isArray(d.fandomIds) || !d.fandomIds.every(Number.isInteger)) return newVisitor();
    }
    if (!Object.values(v.saved).every(validBooth) || v.batches.length > 2 ||
      v.batches.some(batch => !Array.isArray(batch) || batch.some(c => !validBooth(c.booth) || !['interest', 'learning', 'random'].includes(c.reason)))) return newVisitor();
    const seen = new Set<string>();
    v.batches = v.batches.map(batch => batch.filter(card => {
      const decision = v.decisions[card.booth.id];
      if (seen.has(card.booth.id) || decision?.kind === 'like' ||
        (decision?.kind === 'pass' && decision.at !== card.previousDecisionAt && decision.at >= (card.preparedAt ?? Infinity))) return false;
      seen.add(card.booth.id); return true;
    })).filter(b => b.length);
    return { ...v, revisit: Boolean(v.revisit), revisitIds: v.revisitIds?.filter(id => typeof id === 'string') };
  } catch { return newVisitor(); }
}

export function reconcileSaved(visitor: Visitor, snapshot: Snapshot): Visitor {
  const current = new Map(snapshot.booths.map(b => [b.id, b]));
  return { ...visitor, saved: Object.fromEntries(Object.entries(visitor.saved).map(([id, booth]) => [id, current.get(id) ?? booth])) };
}
