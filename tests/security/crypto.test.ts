import { describe, expect, it } from 'vitest';
import { randomCode, randomPin } from '@/lib/ids';
import {
  constantTimeEqual,
  deriveSecrets,
  fromBase64,
  generateStudentKeyPair,
  importPrivateKey,
  newSalt,
  open,
  seal,
  toBase64,
  unwrapBytes,
  wrapBytes,
} from '@/security/crypto';
import {
  ValidationError,
  validateAge,
  validateEmail,
  validateLanguage,
  validateName,
  validatePassword,
  validatePin,
  validateTextContent,
  validateTitle,
} from '@/security/validation';

const FAST = 1000; // PBKDF2 iterations for tests; production uses 600 000

describe('password stretching', () => {
  it('is deterministic for the same secret and salt, different otherwise', async () => {
    const salt = newSalt();
    const a = await deriveSecrets('correct horse', salt, FAST);
    const b = await deriveSecrets('correct horse', salt, FAST);
    const c = await deriveSecrets('correct horsf', salt, FAST);
    const d = await deriveSecrets('correct horse', newSalt(), FAST);
    expect(a.verifier).toBe(b.verifier);
    expect(a.verifier).not.toBe(c.verifier);
    expect(a.verifier).not.toBe(d.verifier);
    expect(fromBase64(a.verifier)).toHaveLength(32);
  });

  it('derives a key-encryption key that cannot be exported', async () => {
    const { kek } = await deriveSecrets('correct horse', newSalt(), FAST);
    expect(kek.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow();
  });

  it('treats visually identical Unicode passwords as the same password', async () => {
    const salt = newSalt();
    const composed = await deriveSecrets('café-2026', salt, FAST);
    const decomposed = await deriveSecrets('café-2026', salt, FAST);
    expect(composed.verifier).toBe(decomposed.verifier);
  });

  it('compares verifiers without short-circuiting', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('key wrapping', () => {
  it('round-trips with the right key and fails with a wrong key or tampered data', async () => {
    const salt = newSalt();
    const right = await deriveSecrets('teacher-pass-1', salt, FAST);
    const wrong = await deriveSecrets('teacher-pass-2', salt, FAST);
    const secret = crypto.getRandomValues(new Uint8Array(64));
    const wrapped = await wrapBytes(secret, right.kek);
    expect([...(await unwrapBytes(wrapped, right.kek))]).toEqual([...secret]);
    await expect(unwrapBytes(wrapped, wrong.kek)).rejects.toThrow();
    const tampered = fromBase64(wrapped.ct);
    tampered[0] = tampered[0]! ^ 1;
    await expect(unwrapBytes({ ...wrapped, ct: toBase64(tampered) }, right.kek)).rejects.toThrow();
  });

  it('uses a fresh IV every time', async () => {
    const { kek } = await deriveSecrets('teacher-pass-1', newSalt(), FAST);
    const a = await wrapBytes(new Uint8Array([1, 2, 3]), kek);
    const b = await wrapBytes(new Uint8Array([1, 2, 3]), kek);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('sealed session records', () => {
  it('can be written with the public key alone and read only with the private key', async () => {
    const alice = await generateStudentKeyPair();
    const mallory = await generateStudentKeyPair();
    const record = { textTitle: 'Le petit prince', wordsRead: 120, note: 'قراءة جيدة' };

    const box = await seal(alice.publicKey, record);
    expect(JSON.stringify(box)).not.toContain('petit prince');
    expect(await open(await importPrivateKey(alice.privateKey), box)).toEqual(record);
    await expect(open(await importPrivateKey(mallory.privateKey), box)).rejects.toThrow();
  });

  it('produces a different ciphertext for the same content each time', async () => {
    const keys = await generateStudentKeyPair();
    const a = await seal(keys.publicKey, { n: 1 });
    const b = await seal(keys.publicKey, { n: 1 });
    expect(a.ct).not.toBe(b.ct);
    expect(a.epk.x).not.toBe(b.epk.x);
  });

  it('detects tampering', async () => {
    const keys = await generateStudentKeyPair();
    const box = await seal(keys.publicKey, { n: 1 });
    const ct = fromBase64(box.ct);
    ct[ct.length - 1] = ct[ct.length - 1]! ^ 0xff;
    await expect(open(await importPrivateKey(keys.privateKey), { ...box, ct: toBase64(ct) })).rejects.toThrow();
  });

  it('exposes no private material in the stored public key', async () => {
    const keys = await generateStudentKeyPair();
    expect(keys.publicKey.d).toBeUndefined();
    expect(keys.publicKey.crv).toBe('P-256');
  });
});

describe('random codes', () => {
  it('generates 4-digit PINs and unambiguous link codes', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomPin()).toMatch(/^\d{4}$/);
      expect(randomCode(8)).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    expect(new Set(Array.from({ length: 200 }, () => randomCode(8))).size).toBe(200);
  });
});

describe('input validation', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof ValidationError ? e.code : `unexpected:${String(e)}`;
    }
    return 'ok';
  };

  it('normalises and bounds names', () => {
    expect(validateName('  Amine ​  Ben\tSalah ')).toBe('Amine Ben Salah');
    expect(validateName('أمين')).toBe('أمين');
    expect(code(() => validateName('   '))).toBe('name-required');
    expect(code(() => validateName('x'.repeat(41)))).toBe('name-too-long');
    // Bidi override characters cannot be smuggled into a displayed name.
    expect(validateName('abc‮dcba')).toBe('abcdcba');
  });

  it('accepts real e-mail addresses only, lower-cased', () => {
    expect(validateEmail(' Prof@Ecole.TN ')).toBe('prof@ecole.tn');
    for (const bad of ['', 'prof', 'prof@', '@ecole.tn', 'a b@c.tn', 'prof@ecole']) expect(code(() => validateEmail(bad))).toBe('email-invalid');
  });

  it('rejects short and trivially weak passwords', () => {
    expect(code(() => validatePassword('abc12'))).toBe('password-too-short');
    expect(code(() => validatePassword('aaaaaaaa'))).toBe('password-too-weak');
    expect(code(() => validatePassword('Password'))).toBe('password-too-weak');
    expect(validatePassword('lecture-2026')).toBe('lecture-2026');
  });

  it('validates PIN, age and language', () => {
    expect(validatePin('0420')).toBe('0420');
    for (const bad of ['123', '12345', '12a4', '']) expect(code(() => validatePin(bad))).toBe('pin-invalid');
    expect(validateAge(9)).toBe(9);
    for (const bad of [4, 19, 9.5, Number.NaN]) expect(code(() => validateAge(bad))).toBe('age-invalid');
    expect(validateLanguage('ar')).toBe('ar');
    expect(code(() => validateLanguage('en'))).toBe('language-invalid');
  });

  it('cleans reading material but keeps its paragraphs', () => {
    expect(validateTextContent('  Un   mot.\r\n\r\n\r\n\r\nDeux\tmots.\u0007  ')).toBe('Un mot.\n\nDeux mots.');
    expect(code(() => validateTextContent(' \n '))).toBe('text-empty');
    expect(code(() => validateTextContent('mot '.repeat(5001)))).toBe('text-too-long');
    expect(validateTitle('  Le   lion ')).toBe('Le lion');
    expect(code(() => validateTitle(''))).toBe('title-required');
    expect(code(() => validateTitle('t'.repeat(121)))).toBe('title-too-long');
  });
});
