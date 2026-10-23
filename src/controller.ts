import { CatalogClient } from './catalog';
import { BrowserStorage, newVisitor, reconcileSaved, restoreVisitor } from './storage';
import type { StorageAdapter } from './storage';
import type { BatchCard, BatchRequest, Booth, Language, Snapshot, Visitor, WorkerRequest, WorkerResponse } from './types';

export interface BatchGenerator {
  generate(request: BatchRequest, generation: number): Promise<BatchCard[]>;
  dispose(): void;
}

export class WorkerGenerator implements BatchGenerator {
  private worker = new Worker(new URL('./recommendation.worker.ts', import.meta.url), { type: 'module' });
  private next = 0;
  private pending = new Map<number, { generation: number; resolve: (cards: BatchCard[]) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const item = this.pending.get(data.id);
      if (!item) return;
      clearTimeout(item.timeout); this.pending.delete(data.id);
      if (data.error || data.generation !== item.generation) item.reject(new Error(data.error ?? 'Stale result'));
      else item.resolve(data.cards ?? []);
    };
    this.worker.onerror = () => this.fail(new Error('Recommendation worker failed'));
  }
  private fail(error: Error) {
    for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(error); }
    this.pending.clear();
  }
  generate(request: BatchRequest, generation: number) {
    const id = ++this.next;
    return new Promise<BatchCard[]>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('Recommendation timeout')); }, 15000);
      this.pending.set(id, { generation, resolve, reject, timeout });
      this.worker.postMessage({ id, generation, request } satisfies WorkerRequest);
    });
  }
  dispose() { this.worker.terminate(); this.fail(new Error('Disposed')); }
}

export interface AppState { visitor: Visitor; snapshot?: Snapshot; loading: boolean; error?: string; generating: boolean; generationError: boolean; generationErrorDetail?: string }

export class AppController {
  private listeners = new Set<() => void>();
  private state: AppState = { visitor: newVisitor(), loading: true, generating: false, generationError: false };
  private writes: Promise<void> = Promise.resolve();
  private fillTask?: Promise<void>;
  private generation = 0;
  private lastCheck = 0;
  private initialized = false;
  private disposed = false;
  private busy = false;
  private tick?: ReturnType<typeof setInterval>;
  private catalog: CatalogClient;
  constructor(private storage: StorageAdapter = new BrowserStorage(), private generator: BatchGenerator = new WorkerGenerator(), fetcher?: typeof fetch) {
    this.catalog = new CatalogClient(storage, fetcher);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<AppState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private save(visitor: Visitor) {
    this.update({ visitor });
    const copy = structuredClone(visitor);
    this.writes = this.writes.catch(() => {}).then(() => this.storage.write('visitor', copy)).catch(() => {});
    return this.writes;
  }
  async start() {
    if (this.initialized) return;
    this.initialized = true;
    const [visitor, cached] = await Promise.all([this.storage.read('visitor'), this.catalog.cached()]);
    if (this.disposed) return;
    this.update({ visitor: restoreVisitor(visitor) });
    if (cached) { this.applySnapshot(cached); this.update({ loading: false }); void this.fill(); }
    await this.refresh();
    if (this.disposed) return;
    this.tick = setInterval(() => {
      if (document.visibilityState === 'visible') { void this.refresh(); void this.fill(); }
    }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', this.onVisible);
  }
  private onVisible = () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - this.lastCheck >= 5 * 60 * 1000) void this.refresh();
      void this.fill();
    }
  };
  private applySnapshot(snapshot: Snapshot) {
    this.update({ snapshot });
    void this.save(reconcileSaved(this.state.visitor, snapshot));
  }
  async refresh() {
    this.lastCheck = Date.now();
    if (!this.state.snapshot) this.update({ loading: true, error: undefined });
    try {
      const snapshot = await this.catalog.refresh();
      if (this.disposed) return;
      if (this.state.snapshot !== snapshot) this.applySnapshot(snapshot);
      this.update({ loading: false, error: undefined });
      void this.fill();
    } catch (error) {
      console.error('Comic Frontinder: catalog startup/update failed', error);
      if (!this.state.snapshot) this.update({ loading: false, error: String(error) });
    }
  }
  fill(): Promise<void> {
    if (this.fillTask) return this.fillTask;
    if (!this.state.snapshot || this.disposed) return Promise.resolve();
    this.fillTask = this.fillBatches().finally(() => { this.fillTask = undefined; });
    return this.fillTask;
  }
  private async fillBatches() {
    this.update({ generating: true, generationError: false, generationErrorDetail: undefined });
    try {
      while (!this.disposed && this.state.visitor.batches.length < 2 && this.state.snapshot) {
        const generation = this.generation;
        const visitor = this.state.visitor;
        const preparedAt = Date.now();
        const queued = visitor.batches.flat().map(c => c.booth);
        const cards = await this.generator.generate({ snapshot: this.state.snapshot, decisions: visitor.decisions,
          excluded: queued.map(b => b.id), queued, seed: visitor.seed, sequence: visitor.sequence,
          now: preparedAt, revisit: visitor.revisit, revisitIds: visitor.revisitIds }, generation);
        if (this.disposed) return;
        if (generation !== this.generation) continue;
        // Decisions can change while a worker runs, e.g. saving from Recommendations.
        const latest = this.state.visitor;
        const occupied = new Set(latest.batches.flat().map(c => c.booth.id));
        const usable = cards.filter(c => !occupied.has(c.booth.id) && latest.decisions[c.booth.id]?.kind !== 'like' &&
          latest.decisions[c.booth.id]?.at === visitor.decisions[c.booth.id]?.at)
          .map(c => ({ ...c, preparedAt, previousDecisionAt: visitor.decisions[c.booth.id]?.at }));
        if (!usable.length) { if (cards.length) continue; break; }
        await this.save({ ...latest, sequence: latest.sequence + 1, batches: [...latest.batches, usable] });
      }
    } catch (error) {
      console.error('Comic Frontinder: recommendation generation failed', error);
      this.update({ generationError: true, generationErrorDetail: error instanceof Error ? error.message : String(error) });
    }
    finally { this.update({ generating: false }); }
  }
  async decide(kind: 'like' | 'pass') {
    if (this.busy) return;
    const card = this.state.visitor.batches[0]?.[0];
    if (!card) return;
    this.busy = true;
    try {
      const visitor = this.state.visitor;
      // Keep the card visible until the decision has been persisted.
      await this.save({ ...visitor,
        decisions: { ...visitor.decisions, [card.booth.id]: { kind, at: Date.now(), fandomIds: card.booth.fandomIds, offerings: card.booth.offerings } },
        revisitIds: visitor.revisitIds?.filter(id => id !== card.booth.id),
        saved: kind === 'like' ? { ...visitor.saved, [card.booth.id]: card.booth } : visitor.saved });
      const latest = this.state.visitor;
      const batches = latest.batches.map(batch => batch.filter(c => c.booth.id !== card.booth.id)).filter(b => b.length);
      await this.save({ ...latest, batches });
      void this.fill();
    } finally { this.busy = false; }
  }
  async toggleSaved(booth: Booth) {
    const visitor = this.state.visitor;
    if (visitor.saved[booth.id]) {
      const saved = { ...visitor.saved }; delete saved[booth.id];
      await this.save({ ...visitor, saved });
    } else {
      this.generation++;
      await this.save({ ...visitor, saved: { ...visitor.saved, [booth.id]: booth },
        decisions: { ...visitor.decisions, [booth.id]: { kind: 'like', at: Date.now(), fandomIds: booth.fandomIds, offerings: booth.offerings } },
        batches: visitor.batches.map(batch => batch.filter(c => c.booth.id !== booth.id)).filter(b => b.length) });
      void this.fill();
    }
  }
  setLanguage(language: Language) { void this.save({ ...this.state.visitor, language }); }
  async revisit() {
    this.generation++;
    await this.save({ ...this.state.visitor, revisit: true,
      revisitIds: Object.entries(this.state.visitor.decisions).filter(([, d]) => d.kind === 'pass').map(([id]) => id), batches: [] });
    void this.fill();
  }
  dispose() {
    this.disposed = true; this.generation++;
    clearInterval(this.tick); document.removeEventListener('visibilitychange', this.onVisible);
    this.generator.dispose();
  }
}
