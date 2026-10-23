// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Gallery, RemoteImage } from '../src/Gallery';
import { copy } from '../src/copy';
import { booth } from './fixtures';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
    if (typeof options === 'object') { this.scrollLeft = options.left ?? 0; this.dispatchEvent(new Event('scroll')); }
  };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const image = (src = 'https://example.com/first.jpg') => <RemoteImage src={src} alt="Catalog" t={copy.en} loading="eager"/>;
const loaded = () => !!document.querySelector('.remote-image.is-loaded');
const catalog = { ...booth('a'), gallery: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'] };
const finger = (clientX: number, clientY = 150) => ({ clientX, clientY });
const size = (el: Element) => {
  Object.defineProperties(el, { clientWidth: { value: 300, configurable: true }, clientHeight: { value: 300, configurable: true } });
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300, toJSON() {} });
};

it('opens on a single image tap and scrolls separate zoom pages without swapping images', () => {
  render(<Gallery booth={catalog} t={copy.en}/>);
  const main = screen.getByLabelText('Catalog: Circle a'); size(main);
  fireEvent.click(screen.getByAltText('Circle a · Catalog 1'));
  const dialog = screen.getByRole('dialog');
  const track = screen.getByLabelText('Catalog pages: Circle a'); size(track);
  const images = [...dialog.querySelectorAll('img')];
  fireEvent.click(dialog.querySelector('[aria-label="Next image"]')!);
  expect(track.scrollLeft).toBe(300);
  expect(main.scrollLeft).toBe(0);
  expect([...dialog.querySelectorAll('img')]).toEqual(images);
  // Native touch scrolling uses the same pages and updates the selected index.
  track.scrollLeft = 600; fireEvent.scroll(track);
  expect(dialog.textContent).toContain('3/3');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(main.scrollLeft).toBe(600);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('returns Discover to normal after a pinch and suppresses the resulting click', () => {
  render(<Gallery booth={catalog} t={copy.en}/>);
  const surface = document.querySelector('.pinch-surface')!; size(surface);
  const content = surface.querySelector<HTMLElement>('.pinch-content')!;
  fireEvent.touchStart(surface, { touches: [finger(100), finger(200)] });
  const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [finger(50), finger(250)] as unknown as Touch[] });
  fireEvent(surface, move);
  expect(move.defaultPrevented).toBe(true);
  expect(content.style.transform).toContain('scale(2)');
  fireEvent.touchEnd(surface, { touches: [] });
  expect(content.style.transform).toContain('scale(1)');
  fireEvent.click(surface);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('retains the selected zoom page when the viewport width changes', () => {
  render(<Gallery booth={catalog} t={copy.en}/>);
  fireEvent.click(screen.getByAltText('Circle a · Catalog 1'));
  const dialog = screen.getByRole('dialog');
  const track = screen.getByLabelText('Catalog pages: Circle a'); size(track);
  fireEvent.click(dialog.querySelector('[aria-label="Next image"]')!);
  expect(track.scrollLeft).toBe(300);
  Object.defineProperty(track, 'clientWidth', { value: 600 });
  fireEvent.scroll(track);
  expect(track.scrollLeft).toBe(600);
  expect(dialog.textContent).toContain('2/3');
});

it('retains image zoom in the viewer, supports panning, and resets it when changing page', () => {
  render(<Gallery booth={catalog} t={copy.en}/>);
  fireEvent.click(screen.getByAltText('Circle a · Catalog 1'));
  const dialog = screen.getByRole('dialog');
  const surface = dialog.querySelector('.pinch-surface')!; size(surface);
  const content = surface.querySelector<HTMLElement>('.pinch-content')!;
  fireEvent.touchStart(surface, { touches: [finger(100), finger(200)] });
  fireEvent.touchMove(surface, { touches: [finger(50), finger(250)] });
  fireEvent.touchEnd(surface, { touches: [] });
  expect(content.style.transform).toContain('scale(2)');
  fireEvent.touchStart(surface, { touches: [finger(100)] });
  fireEvent.touchMove(surface, { touches: [finger(120)] });
  fireEvent.touchEnd(surface, { touches: [] });
  expect(content.style.transform).toContain('translate(20px, 0px)');
  const track = screen.getByLabelText('Catalog pages: Circle a'); size(track);
  fireEvent.click(dialog.querySelector('[aria-label="Next image"]')!);
  expect(content.style.transform).toContain('scale(1)');
});

it('does not open zoom after a horizontal swipe or when retrying an image', () => {
  render(<Gallery booth={catalog} t={copy.en}/>);
  const surface = document.querySelector('.pinch-surface')!;
  fireEvent.touchStart(surface, { touches: [finger(250)] });
  fireEvent.touchMove(surface, { touches: [finger(50)] });
  fireEvent.touchEnd(surface, { touches: [] });
  fireEvent.click(surface);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.error(screen.getByAltText('Circle a · Catalog 1'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry image' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps a fast load visible when it arrives before passive effects', () => {
  function FastImage() {
    useLayoutEffect(() => { fireEvent.load(screen.getByAltText('Catalog')); }, []);
    return image();
  }
  render(<FastImage/>);
  expect(loaded()).toBe(true);
  expect(document.querySelector('.image-placeholder')).toBeNull();
});

it('recognizes an already cached image without waiting for another load event', () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1200);
  const view = render(image());
  expect(loaded()).toBe(true);
  view.unmount();
  render(image('https://example.com/next.jpg'));
  expect(loaded()).toBe(true);
  expect(document.querySelector('.image-placeholder')).toBeNull();
});

it('resets for a new source and allows retry after a failed request', () => {
  const view = render(image());
  fireEvent.load(screen.getByAltText('Catalog'));
  expect(loaded()).toBe(true);
  view.rerender(image('https://example.com/next.jpg'));
  expect(loaded()).toBe(false);
  fireEvent.error(screen.getByAltText('Catalog'));
  expect(document.querySelector('.image-failure')).not.toBeNull();
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1200);
  fireEvent.click(screen.getByRole('button', { name: copy.en.imageRetry }));
  expect(loaded()).toBe(true);
  expect(document.querySelector('.image-failure')).toBeNull();
});
