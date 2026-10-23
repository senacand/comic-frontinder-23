import type { Booth, Snapshot } from './types';
import type { StorageAdapter } from './storage';
import { normalizeOfferings } from './goods';

export const DATA_ORIGIN = 'https://cf23-config.nnt.gg';
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data');
  return value as Record<string, unknown>;
};
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
const webUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
};

export function parseSnapshot(catalogRaw: unknown, fandomRaw: unknown, version: number): Snapshot {
  const catalog = object(catalogRaw), directory = object(fandomRaw);
  if (catalog.schemaVersion !== '1.0.0' || directory.schemaVersion !== '1.0.0' ||
    !Array.isArray(catalog.exhibitors) || !Array.isArray(directory.fandoms)) throw new Error('Unsupported catalog format');
  const fandoms = directory.fandoms.map(value => {
    const f = object(value);
    if (!Number.isInteger(f.id) || typeof f.name !== 'string') throw new Error('Invalid fandom');
    return { id: f.id as number, name: f.name, kind: typeof f.kind === 'string' ? f.kind : 'unknown' };
  });
  const known = new Set(fandoms.map(f => f.id));
  if (known.size !== fandoms.length) throw new Error('Duplicate fandom IDs');
  const booths: Booth[] = [];
  const ids = new Set<string>();
  for (const value of catalog.exhibitors) {
    const b = object(value);
    if ((typeof b.id !== 'string' && typeof b.id !== 'number') || typeof b.name !== 'string') throw new Error('Invalid exhibitor');
    const id = String(b.id);
    if (!id || ids.has(id)) throw new Error('Duplicate or empty exhibitor ID');
    ids.add(id);
    const assets = b.assets == null ? {} : object(b.assets);
    const gallery = [...new Set(strings(assets.gallery).filter(webUrl))];
    if (!gallery.length) continue;
    booths.push({ id, name: b.name, gallery,
      spaces: Array.isArray(b.spaces) ? b.spaces.map(s => object(s).code).filter((s): s is string => typeof s === 'string' && !!s) : [],
      days: strings(b.attendanceDates),
      offerings: normalizeOfferings(b.offerings),
      fandomIds: Array.isArray(b.fandomIds) ? [...new Set(b.fandomIds.filter((id): id is number => typeof id === 'number' && known.has(id)))] : [],
      thumbnail: webUrl(assets.thumbnail) ? assets.thumbnail : undefined,
      catalogUrl: webUrl(b.catalogUrl) ? b.catalogUrl : undefined,
    });
  }
  return { version, booths, fandoms, offeringsVersion: 1 };
}

export function validBooth(raw: unknown): raw is Booth {
  try {
    const b = raw as Booth;
    return typeof b.id === 'string' && !!b.id && typeof b.name === 'string' &&
      Array.isArray(b.gallery) && b.gallery.length > 0 && b.gallery.every(webUrl) &&
      Array.isArray(b.spaces) && b.spaces.every(s => typeof s === 'string') &&
      Array.isArray(b.days) && b.days.every(s => typeof s === 'string') &&
      Array.isArray(b.fandomIds) && b.fandomIds.every(Number.isInteger) &&
      (b.offerings === undefined || (Array.isArray(b.offerings) && b.offerings.every(s => typeof s === 'string')));
  } catch { return false; }
}

export function validSnapshot(raw: unknown): raw is Snapshot {
  try {
    const s = raw as Snapshot;
    return Number.isInteger(s.version) && s.version >= 0 && Array.isArray(s.fandoms) && Array.isArray(s.booths) &&
      s.fandoms.every(f => Number.isInteger(f.id) && typeof f.name === 'string' && typeof f.kind === 'string') &&
      s.booths.every(validBooth) && new Set(s.booths.map(b => b.id)).size === s.booths.length;
  } catch { return false; }
}

export class CatalogClient {
  private active?: Promise<Snapshot>;
  private current?: Snapshot;
  constructor(private storage: StorageAdapter, private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async cached() {
    const raw = await this.storage.read<Snapshot>('snapshot');
    if (validSnapshot(raw)) { this.current = raw; return raw; }
  }

  private async json(path: string) {
    const url = `${DATA_ORIGIN}/${path}`;
    // AbortSignal.timeout is absent in some embedded browsers. Use the widely
    // supported controller so compatibility failures cannot prevent a request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await this.fetcher(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as unknown;
    } catch (error) {
      const reason = controller.signal.aborted ? 'Request timed out after 25 seconds' : error instanceof Error ? error.message : String(error);
      throw new Error(`${path}: ${reason}`, { cause: error });
    } finally { clearTimeout(timer); }
  }

  private async version() {
    const manifest = object(await this.json('last-updated.json'));
    if (!Number.isInteger(manifest.creator_data_version) || (manifest.creator_data_version as number) < 0) throw new Error('Invalid catalog version');
    return manifest.creator_data_version as number;
  }

  refresh(): Promise<Snapshot> {
    if (this.active) return this.active;
    this.active = this.download().finally(() => { this.active = undefined; });
    return this.active;
  }

  private async download() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = await this.version();
      if (this.current && version <= this.current.version && this.current.offeringsVersion === 1) return this.current;
      const [catalog, fandoms] = await Promise.all([
        this.json(`v1/catalog.json?v=${version}`), this.json(`v1/fandoms.json?v=${version}`),
      ]);
      const snapshot = parseSnapshot(catalog, fandoms, version);
      if (await this.version() !== version) continue;
      await this.storage.write('snapshot', snapshot);
      this.current = snapshot;
      return snapshot;
    }
    throw new Error('Catalog changed while downloading');
  }
}
