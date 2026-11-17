export const uid = (): string => crypto.randomUUID();

/** Human-typable random code (no look-alike characters). */
export function randomCode(length: number, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'): string {
  const out: string[] = [];
  const limit = 256 - (256 % alphabet.length); // rejection sampling: no modulo bias
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]!);
    }
  }
  return out.join('');
}

export const randomPin = (): string => randomCode(4, '0123456789');
