/**
 * Cryptographic building blocks, all on top of the browser's Web Crypto API.
 *
 * Scheme (see docs/PRIVACY_AND_SECURITY.md for the threat model):
 *  - Passwords and PINs: PBKDF2-HMAC-SHA256 → master secret → HKDF into two
 *    independent values: a verifier (stored) and a key-encryption key (never stored).
 *  - Each student has an ECDH P-256 key pair. Session records are encrypted to
 *    the PUBLIC key (ephemeral-static ECDH + HKDF + AES-256-GCM), so the code
 *    running a student's session can write records but cannot read any.
 *  - The PRIVATE key is stored only in wrapped form, once per adult allowed to
 *    read that student's records, under that adult's key-encryption key.
 *
 * There are no hardcoded secrets anywhere: every key is random or derived
 * from something a person knows.
 */

export const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256

export interface WrappedKey {
  iv: string;
  ct: string;
}

export interface SealedBox {
  /** Ephemeral public key of the sender. */
  epk: JsonWebKey;
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** Copies into a fresh ArrayBuffer-backed view, which is what SubtleCrypto's types require. */
const buf = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));
export const newSalt = (): string => toBase64(randomBytes(16));

async function hkdf(master: ArrayBuffer, info: string, usage: 'bits'): Promise<ArrayBuffer>;
async function hkdf(master: ArrayBuffer, info: string, usage: 'aes'): Promise<CryptoKey>;
async function hkdf(master: ArrayBuffer, info: string, usage: 'bits' | 'aes'): Promise<ArrayBuffer | CryptoKey> {
  const key = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) };
  if (usage === 'bits') return crypto.subtle.deriveBits(params, key, 256);
  return crypto.subtle.deriveKey(params, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface DerivedSecrets {
  /** Stored to check a password later. Reveals nothing about `kek`. */
  verifier: string;
  /** Non-extractable AES-GCM key used to wrap student private keys. */
  kek: CryptoKey;
}

/** Stretches a password or PIN. Deliberately slow: this is the cost an attacker pays per guess. */
export async function deriveSecrets(secret: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<DerivedSecrets> {
  const material = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, material, 256);
  const [verifier, kek] = await Promise.all([hkdf(master, 'qalam/verifier/v1', 'bits'), hkdf(master, 'qalam/kek/v1', 'aes')]);
  return { verifier: toBase64(new Uint8Array(verifier)), kek };
}

/** Compares two strings without an early exit, so timing does not leak the match length. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export interface StudentKeyPair {
  publicKey: JsonWebKey;
  /** PKCS#8 bytes. Wrap immediately; never store as-is. */
  privateKey: Uint8Array<ArrayBuffer>;
}

export async function generateStudentKeyPair(): Promise<StudentKeyPair> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const [publicKey, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ]);
  return { publicKey, privateKey: new Uint8Array(pkcs8) };
}

export async function wrapBytes(bytes: Uint8Array, kek: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, buf(bytes));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** Throws if the key is wrong or the data was tampered with (AES-GCM is authenticated). */
export async function unwrapBytes(wrapped: WrappedKey, kek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(wrapped.iv) }, kek, fromBase64(wrapped.ct));
  return new Uint8Array(pt);
}

export const importPrivateKey = (pkcs8: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('pkcs8', buf(pkcs8), ECDH, false, ['deriveBits']);

async function sharedAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return hkdf(shared, 'qalam/session-record/v1', 'aes');
}

/** Encrypts a JSON value so that only the holder of the matching private key can read it. */
export async function seal(recipient: JsonWebKey, value: unknown): Promise<SealedBox> {
  const [ephemeral, publicKey] = await Promise.all([
    crypto.subtle.generateKey(ECDH, true, ['deriveBits']),
    crypto.subtle.importKey('jwk', recipient, ECDH, false, []),
  ]);
  const key = await sharedAesKey(ephemeral.privateKey, publicKey);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { epk: await crypto.subtle.exportKey('jwk', ephemeral.publicKey), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function open<T>(privateKey: CryptoKey, box: SealedBox): Promise<T> {
  const epk = await crypto.subtle.importKey('jwk', box.epk, ECDH, false, []);
  const key = await sharedAesKey(privateKey, epk);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.ct));
  return JSON.parse(dec.decode(pt)) as T;
}
