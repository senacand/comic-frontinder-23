// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve('index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const meta = (name: string) => doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content');
const publicFile = (file: string) => readFileSync(resolve('public', file));
const canonical = doc.querySelector('link[rel="canonical"]')!.getAttribute('href')!;

describe('static search and sharing metadata', () => {
  it('provides Indonesian copy and a consistent public URL without running JavaScript', () => {
    expect(doc.documentElement.lang).toBe('id');
    expect(doc.title).toContain('Comifuro 23');
    expect(meta('description')).toContain('Kenalan dulu sama calon booth favoritmu');
    expect(meta('og:description')).toBe(meta('description'));
    expect(meta('twitter:description')).toBe(meta('description'));
    expect(canonical).toBe('https://comicfrontinder.sena.dev/');
    expect(meta('og:url')).toBe(canonical);
    expect(meta('og:locale')).toBe('id_ID');
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('og:title')).toBe('Comic Frontinder - Cari booth yang match sama kamu');
    expect(meta('og:title')).toBe(meta('twitter:title'));
  });

  it('ships a real social image with matching dimensions and accessible descriptions', () => {
    const image = meta('og:image')!;
    expect(image).toBe(new URL('social-card.png', canonical).href);
    expect(meta('twitter:image')).toBe(image);
    expect(meta('og:image:secure_url')).toBe(image);
    expect(meta('og:image:type')).toBe('image/png');
    expect(meta('og:image:alt')).toBeTruthy();
    expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'));
    const png = publicFile('social-card.png');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(Number(meta('og:image:width')));
    expect(png.readUInt32BE(20)).toBe(Number(meta('og:image:height')));
  });

  it('keeps structured data, sitemap, and app icons valid for a nested deployment', () => {
    const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(data['@graph'].map((item: { '@type': string }) => item['@type'])).toEqual(['WebSite', 'WebApplication']);
    for (const item of data['@graph']) expect(item.url).toBe(canonical);
    expect(publicFile('robots.txt').toString()).toContain(`Sitemap: ${canonical}sitemap.xml`);
    const sitemap = new DOMParser().parseFromString(publicFile('sitemap.xml').toString(), 'application/xml');
    expect(sitemap.querySelector('parsererror')).toBeNull();
    expect(sitemap.querySelector('loc')?.textContent).toBe(canonical);
    const manifest = JSON.parse(publicFile('site.webmanifest').toString());
    expect(manifest.lang).toBe('id');
    expect(new URL(manifest.start_url, canonical).href).toBe(`${canonical}#/discover`);
    for (const icon of manifest.icons) {
      const png = publicFile(icon.src.replace('./', ''));
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
