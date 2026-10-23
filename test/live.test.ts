import { expect, it } from 'vitest';
import { env } from 'node:process';
import { DATA_ORIGIN, parseSnapshot } from '../src/catalog';

it.skipIf(env.RUN_LIVE_CATALOG !== '1')('validates the live catalog contract, CORS, and an actual gallery image', async () => {
  const headers = { Origin: 'https://example.github.io' };
  const manifestResponse = await fetch(`${DATA_ORIGIN}/last-updated.json`, { headers });
  expect(manifestResponse.ok).toBe(true);
  expect(manifestResponse.headers.get('access-control-allow-origin')).toBe('*');
  const manifest = await manifestResponse.json();
  const [catalogResponse, fandomResponse] = await Promise.all([
    fetch(`${DATA_ORIGIN}/v1/catalog.json?v=${manifest.creator_data_version}`, { headers }),
    fetch(`${DATA_ORIGIN}/v1/fandoms.json?v=${manifest.creator_data_version}`, { headers }),
  ]);
  for (const response of [catalogResponse, fandomResponse]) {
    expect(response.ok).toBe(true);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  }
  const snapshot = parseSnapshot(await catalogResponse.json(), await fandomResponse.json(), manifest.creator_data_version);
  expect(snapshot.booths.length).toBeGreaterThan(0);
  const image = await fetch(snapshot.booths[0].gallery[0], { method: 'HEAD', headers });
  expect(image.ok).toBe(true);
  expect(image.headers.get('content-type')).toMatch(/^image\//);
  console.log(`Live version ${snapshot.version}: ${snapshot.booths.length} eligible booths, ${snapshot.fandoms.length} fandoms; catalog image HTTP ${image.status}`);
}, 60000);
