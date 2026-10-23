const MAP_URL = 'https://cf23.nnt.gg/';

// Matches the map's IntEncoding: sorted IDs, delta varints, unpadded base64url.
export function creatorListMapUrl(ids: string[]): string | undefined {
  const numbers = [...new Set(ids.filter(id => /^\d+$/.test(id)).map(Number))]
    .filter(id => Number.isSafeInteger(id) && id >= 0 && id <= 0x7fffffff)
    .sort((a, b) => a - b);
  if (!numbers.length) return undefined;
  const bytes: number[] = [];
  let previous = 0;
  for (const id of numbers) {
    let value = id - previous;
    while (value >= 128) {
      bytes.push((value % 128) + 128);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
    previous = id;
  }
  const code = btoa(bytes.map(byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL(MAP_URL);
  url.searchParams.set('list', code);
  return url.toString();
}
