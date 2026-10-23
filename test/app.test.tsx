// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AppController } from '../src/controller';
import { generateBatch } from '../src/engine';
import type { StorageAdapter } from '../src/storage';
import type { Visitor } from '../src/types';
import { booth, snapshot, visitor } from './fixtures';

let controller: AppController;
let records: Map<string, unknown>;
const first = { ...booth('a'), gallery: ['https://example.com/a1.jpg', 'https://example.com/a2.jpg'] };
beforeEach(() => {
  location.hash = '#/discover';
  vi.stubGlobal('scrollTo', vi.fn());
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, _y?: number) {
    if (options && typeof options === 'object') { this.scrollLeft = Number(options.left ?? 0); this.dispatchEvent(new Event('scroll')); }
  };
  const v = visitor(); v.batches = [[{ booth: first, reason: 'learning' }, { booth: booth('b'), reason: 'learning' }]];
  records = new Map([['visitor', v as unknown], ['snapshot', snapshot([first, booth('b'), booth('c', [2])])]]);
  const storage: StorageAdapter = { read: async <T,>(key: string) => structuredClone(records.get(key)) as T,
    write: async (key, value) => { records.set(key, structuredClone(value)); } };
  controller = new AppController(storage, { generate: async r => generateBatch(r), dispose() {} }, async () => { throw new Error('offline'); });
});
afterEach(() => { cleanup(); controller.dispose(); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => { render(<App controller={controller}/>); await controller.start(); await controller.fill(); });
}
async function navigate(hash: string) {
  await act(async () => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

describe('app interactions', () => {
  it('starts in Indonesian, changes language, persists it, and supports keyboard likes', async () => {
    await mount();
    expect(screen.getByRole('button', { name: /Suka & simpan/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Like & save/ })).toBeTruthy());
    expect(document.documentElement.lang).toBe('en');
    fireEvent.keyDown(document.body, { key: 'l' });
    await waitFor(() => expect(controller.getSnapshot().visitor.saved.a).toBeTruthy());
    expect((records.get('visitor') as Visitor).language).toBe('en');
    expect(screen.getByRole('heading', { name: 'Circle b' })).toBeTruthy();
  });
  it('keeps image navigation separate from decisions and supports zoom and retry', async () => {
    await mount();
    const track = screen.getByLabelText('Katalog: Circle a');
    Object.defineProperty(track, 'clientWidth', { value: 400 });
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(track.scrollLeft).toBe(400);
    expect(controller.getSnapshot().visitor.decisions).toEqual({});
    fireEvent.click(screen.getByRole('button', { name: 'Perbesar katalog' }));
    expect(screen.getByRole('dialog', { name: 'Perbesar katalog: Circle a' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    const image = screen.getByAltText('Circle a · Katalog 1');
    fireEvent.error(image);
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang gambar' }));
    expect(screen.getByAltText('Circle a · Katalog 1')).toBeTruthy();
    expect(controller.getSnapshot().visitor.decisions).toEqual({});
  });
  it('renders recommendations including previously passed booths, opens details, and saves', async () => {
    const v = records.get('visitor') as Visitor;
    v.decisions = { a: { kind: 'like', at: 1, fandomIds: [1] }, b: { kind: 'pass', at: Date.now(), fandomIds: [1] } };
    v.saved = { a: first }; v.batches = [];
    await mount(); await navigate('#/recommendations');
    expect(screen.getByRole('button', { name: 'Circle a' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Circle b' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Circle c' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Katalog: Circle b' }));
    expect(screen.getByRole('dialog', { name: 'Circle b' })).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog', { name: 'Circle b' }).querySelector('.primary-button')!);
    await waitFor(() => expect(controller.getSnapshot().visitor.saved.b).toBeTruthy());
    expect(controller.getSnapshot().visitor.decisions.b.kind).toBe('like');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    await navigate('#/saved');
    expect(screen.getAllByRole('button', { name: 'Hapus dari simpanan' })).toHaveLength(2);
  });
  it('provides a useful empty recommendation state and saves the latest metadata', async () => {
    await mount(); await navigate('#/recommendations');
    expect(screen.getByRole('heading', { name: 'Belum ada rekomendasi' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Jelajahi booth/ }).getAttribute('href')).toBe('#/discover');
    await navigate('#/saved');
    expect(screen.getByRole('heading', { name: 'Belum ada booth tersimpan' })).toBeTruthy();
  });
  it('paginates recommendations and removes saves without removing learned interests', async () => {
    const v = records.get('visitor') as Visitor;
    v.decisions = { seed: { kind: 'like', at: 1, fandomIds: [1] } }; v.batches = [];
    records.set('snapshot', snapshot(Array.from({ length: 25 }, (_, i) => booth(`id${i}`))));
    await mount(); await navigate('#/recommendations');
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Lihat lebih banyak' }));
    expect(screen.getAllByRole('article')).toHaveLength(25);
    fireEvent.click(screen.getAllByRole('button', { name: 'Simpan booth' })[0]);
    await waitFor(() => expect(Object.keys(controller.getSnapshot().visitor.saved)).toHaveLength(1));
    const savedId = Object.keys(controller.getSnapshot().visitor.saved)[0];
    fireEvent.click(screen.getByRole('button', { name: 'Hapus dari simpanan' }));
    await waitFor(() => expect(Object.keys(controller.getSnapshot().visitor.saved)).toHaveLength(0));
    expect(controller.getSnapshot().visitor.decisions[savedId].kind).toBe('like');
    expect(screen.getAllByRole('article')).toHaveLength(25);
  });
});
