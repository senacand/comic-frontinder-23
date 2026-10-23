// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteImage } from '../src/Gallery';
import { copy } from '../src/copy';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const image = (src = 'https://example.com/first.jpg') => <RemoteImage src={src} alt="Catalog" t={copy.en} loading="eager"/>;
const loaded = () => !!document.querySelector('.remote-image.is-loaded');

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
