import { describe, expect, it } from 'vitest';
import { creatorListMapUrl } from '../src/map-link';

export function decodeMapIds(url: string) {
  let code = new URL(url).searchParams.get('list')!.replaceAll('-', '+').replaceAll('_', '/');
  code += '='.repeat((4 - code.length % 4) % 4);
  const result: number[] = [];
  let value = 0, shift = 0, previous = 0;
  for (const char of atob(code)) {
    const byte = char.charCodeAt(0);
    value += (byte & 127) * 2 ** shift;
    if (byte & 128) shift += 7;
    else { previous += value; result.push(previous); value = 0; shift = 0; }
  }
  return result;
}

describe('creator list map links', () => {
  it('matches the map delta-varint/base64url format', () => {
    expect(creatorListMapUrl(['130', '2', '1', '2'])).toBe('https://cf23.nnt.gg/?list=AQGAAQ');
    expect(creatorListMapUrl(['1'])).toBe('https://cf23.nnt.gg/?list=AQ');
  });
  it('round-trips real catalog IDs and emits only unpadded URL-safe characters', () => {
    const ids = [1000004, 1000100, 12364, 2147483647];
    const url = creatorListMapUrl(ids.map(String))!;
    expect(decodeMapIds(url)).toEqual([...ids].sort((a, b) => a - b));
    expect(new URL(url).searchParams.get('list')).toMatch(/^[\w-]+$/);
  });
  it('does not produce an empty map list or accept invalid IDs', () => {
    expect(creatorListMapUrl([])).toBeUndefined();
    expect(creatorListMapUrl(['-1', 'not-an-id', '1.5', '2147483648', ''])).toBeUndefined();
  });
});
