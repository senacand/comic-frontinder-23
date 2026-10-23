// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AppController } from '../src/controller';
import { generateBatch } from '../src/engine';
import { creatorListMapUrl } from '../src/map-link';
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
  it('shows the strongest fandom interests before the tag cutoff across views', async () => {
    const featured = booth('a', [1, 2, 3, 4, 5, 6, 7]);
    const v = records.get('visitor') as Visitor;
    v.batches = [[{ booth: featured, reason: 'learning' }]];
    v.decisions = {
      liked: { kind: 'like', at: 1, fandomIds: [7] },
      passed: { kind: 'pass', at: 1, fandomIds: [1] },
    };
    v.saved = { a: featured };
    records.set('snapshot', snapshot([featured]));
    const tags = () => [...document.querySelectorAll('.fandom-tag:not(.tag-more)')].map(tag => tag.textContent);
    await mount();
    expect(tags()).toEqual(['Fandom 7', 'Fandom 2', 'Fandom 3', 'Fandom 4', 'Fandom 5']);
    fireEvent.click(document.querySelector('.tag-more')!);
    expect(tags()).toEqual(['Fandom 7', 'Fandom 2', 'Fandom 3', 'Fandom 4', 'Fandom 5', 'Fandom 6', 'Fandom 1']);
    expect(featured.fandomIds).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await navigate('#/saved');
    expect(tags()[0]).toBe('Fandom 7');
    fireEvent.click(screen.getByRole('button', { name: 'Katalog: Circle a' }));
    expect([...screen.getByRole('dialog').querySelectorAll('.fandom-tag')][0].textContent).toBe('Fandom 7');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    await navigate('#/recommendations');
    expect(tags()).toEqual(['Fandom 7']);
  });
  it('starts in Indonesian, changes language, persists it, and supports keyboard likes', async () => {
    await mount();
    expect(screen.getByRole('button', { name: /Suka/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Comic Frontinder' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Daftar Suka' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Like/ })).toBeTruthy());
    expect(document.documentElement.lang).toBe('en');
    fireEvent.keyDown(document.body, { key: 'l' });
    await waitFor(() => expect(controller.getSnapshot().visitor.saved.a).toBeTruthy());
    expect((records.get('visitor') as Visitor).language).toBe('en');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Circle b' })).toBeTruthy());
  });
  it('keeps image navigation separate from decisions and supports zoom and retry', async () => {
    await mount();
    const track = screen.getByLabelText('Katalog: Circle a');
    Object.defineProperty(track, 'clientWidth', { value: 400 });
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(track.scrollLeft).toBe(400);
    fireEvent.click(screen.getByRole('button', { name: 'Katalog 1' }));
    expect(track.scrollLeft).toBe(0);
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
  it('persists a reaction immediately and ignores repeated input during its animation', async () => {
    await mount();
    const commit = vi.spyOn(controller, 'decide');
    fireEvent.click(screen.getByRole('button', { name: /Suka/ }));
    expect(document.querySelector('.reaction-symbol svg')).toBeTruthy();
    expect(document.querySelector('.reaction-overlay')?.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Lewati/ }));
    fireEvent.keyDown(document.body, { key: 'l' });
    await waitFor(() => expect(controller.getSnapshot().visitor.decisions.a?.kind).toBe('like'));
    expect(screen.getByRole('heading', { name: 'Circle a' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Suka/ }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Circle b' })).toBeTruthy());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(Object.keys(controller.getSnapshot().visitor.decisions)).toEqual(['a']);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('.decision-notice')).toBeNull();
  });
  it('supports direct page selection and double-click zoom without recording feedback', async () => {
    await mount();
    const track = screen.getByLabelText('Katalog: Circle a');
    Object.defineProperty(track, 'clientWidth', { value: 400 });
    const second = screen.getByRole('button', { name: 'Katalog 2' });
    fireEvent.click(second);
    expect(track.scrollLeft).toBe(400);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    fireEvent.doubleClick(track);
    expect(screen.getByRole('dialog', { name: 'Perbesar katalog: Circle a' })).toBeTruthy();
    expect(controller.getSnapshot().visitor.decisions).toEqual({});
  });
  it('skips the reaction delay and smooth scrolling when reduced motion is enabled', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
    await mount();
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    fireEvent.click(screen.getByRole('button', { name: 'Katalog 2' }));
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Lewati/ }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('heading', { name: 'Circle b' })).toBeTruthy();
      expect(controller.getSnapshot().visitor.decisions.a.kind).toBe('pass');
    } finally {
      cleanup(); controller.dispose(); vi.useRealTimers(); scroll.mockRestore();
    }
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
    expect(screen.getAllByRole('button', { name: 'Hapus dari daftar suka' })).toHaveLength(2);
  });
  it('provides a useful empty recommendation state and saves the latest metadata', async () => {
    await mount(); await navigate('#/recommendations');
    expect(screen.getByRole('heading', { name: 'Belum ada rekomendasi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buka di peta' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('link', { name: /Jelajahi booth/ }).getAttribute('href')).toBe('#/discover');
    await navigate('#/saved');
    expect(screen.getByRole('heading', { name: 'Belum ada yang disukai' })).toBeTruthy();
  });
  it('paginates recommendations and removes saves without removing learned interests', async () => {
    const v = records.get('visitor') as Visitor;
    v.decisions = { seed: { kind: 'like', at: 1, fandomIds: [1] } }; v.batches = [];
    records.set('snapshot', snapshot(Array.from({ length: 25 }, (_, i) => booth(`id${i}`))));
    await mount(); await navigate('#/recommendations');
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Lihat lebih banyak' }));
    expect(screen.getAllByRole('article')).toHaveLength(25);
    fireEvent.click(screen.getAllByRole('button', { name: 'Sukai booth' })[0]);
    await waitFor(() => expect(Object.keys(controller.getSnapshot().visitor.saved)).toHaveLength(1));
    const savedId = Object.keys(controller.getSnapshot().visitor.saved)[0];
    fireEvent.click(screen.getByRole('button', { name: 'Hapus dari daftar suka' }));
    await waitFor(() => expect(Object.keys(controller.getSnapshot().visitor.saved)).toHaveLength(0));
    expect(controller.getSnapshot().visitor.decisions[savedId].kind).toBe('like');
    expect(screen.getAllByRole('article')).toHaveLength(25);
  });
  it('opens all filtered recommendations and available saved booths in the map', async () => {
    const booths = Array.from({ length: 25 }, (_, i) => booth(String(1000000 + i), [i < 21 ? 1 : 2]));
    const v = records.get('visitor') as Visitor;
    v.decisions = { seed: { kind: 'like', at: 1, fandomIds: [1, 2] } }; v.batches = [];
    v.saved = { [booths[0].id]: booths[0], [booths[1].id]: booths[1], '1000999': booth('1000999') };
    records.set('snapshot', snapshot(booths));
    await mount(); await navigate('#/recommendations');
    const link = screen.getByRole('link', { name: 'Buka di peta' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(link.getAttribute('href')).toBe(creatorListMapUrl(booths.map(b => b.id)));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Fandom 2' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(link.getAttribute('href')).toBe(creatorListMapUrl(booths.slice(21).map(b => b.id)));
    await navigate('#/saved');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Buka di peta' }).getAttribute('href')).toBe(creatorListMapUrl(booths.slice(0, 2).map(b => b.id)));
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('link', { name: 'Open in Map' })).toBeTruthy();
  });
});
