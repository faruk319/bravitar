// UUIDv7 (RFC 9562): 48-bit unix-ms timestamp, then random bits. Time-ordered,
// so primary-key indexes stay compact. Generated here, never by the database.
export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[0] = (now / 2 ** 40) & 0xff;
  b[1] = (now / 2 ** 32) & 0xff;
  b[2] = (now / 2 ** 24) & 0xff;
  b[3] = (now / 2 ** 16) & 0xff;
  b[4] = (now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70; // version 7
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Milliseconds encoded in a v7 id; useful in tests and for rough ordering.
export function uuidv7Time(id: string): number {
  return parseInt(id.replaceAll("-", "").slice(0, 12), 16);
}
