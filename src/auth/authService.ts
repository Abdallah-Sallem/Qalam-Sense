/**
 * Accounts, sign-in and the current session.
 *
 * There is no server: accounts live in this browser's IndexedDB. Passwords
 * are stretched with PBKDF2 and only a verifier is stored. After repeated
 * failures sign-in is refused for a growing delay. The signed-in session is
 * kept in IndexedDB (not localStorage) so that the adult's key-encryption key
 * can be stored as a non-extractable CryptoKey and survive a page refresh.
 */
import type { Db } from '@/data/db';
import type { Account, AuthSession, Role } from '@/domain/types';
import { randomPin, uid } from '@/lib/ids';
import { PBKDF2_ITERATIONS, constantTimeEqual, deriveSecrets, newSalt, unwrapBytes, wrapBytes } from '@/security/crypto';
import { validateEmail, validateName, validatePassword, validatePin } from '@/security/validation';
import type { AuditLog } from '@/services/audit';
import { AppError } from '@/services/errors';

export interface AuthConfig {
  iterations: number;
  now: () => number;
}

const SESSION_MS: Record<Role, number> = {
  student: 2 * 3600_000,
  parent: 4 * 3600_000,
  teacher: 8 * 3600_000,
};

export const LOCKOUT = { freeAttempts: 5, baseMs: 30_000, maxMs: 15 * 60_000 };

/** Delay imposed after the n-th consecutive failure (0 while under the free attempts). */
export function lockDelay(failedAttempts: number): number {
  if (failedAttempts < LOCKOUT.freeAttempts) return 0;
  return Math.min(LOCKOUT.maxMs, LOCKOUT.baseMs * 2 ** (failedAttempts - LOCKOUT.freeAttempts));
}

export class AuthService {
  private session: AuthSession | null = null;
  readonly config: AuthConfig;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    config: Partial<AuthConfig> = {},
  ) {
    this.config = { iterations: PBKDF2_ITERATIONS, now: Date.now, ...config };
  }

  /** Restores the session saved by a previous page load, if it has not expired. */
  async restore(): Promise<AuthSession | null> {
    const saved = await this.db.get('auth', 'current');
    if (!saved || saved.expiresAt <= this.config.now() || !(await this.db.get('accounts', saved.accountId))) {
      if (saved) await this.db.delete('auth', 'current');
      this.session = null;
      return null;
    }
    const { id: _id, ...session } = saved;
    this.session = session;
    return session;
  }

  current(): AuthSession | null {
    if (this.session && this.session.expiresAt <= this.config.now()) this.session = null;
    return this.session;
  }

  /** The current session, which must exist and (optionally) have the given role. */
  require(role?: Role): AuthSession {
    const s = this.current();
    if (!s) throw new AppError('not-signed-in');
    if (role && s.role !== role) throw new AppError('forbidden');
    return s;
  }

  async registerAdult(role: 'teacher' | 'parent', input: { email: string; password: string; displayName: string }): Promise<Account> {
    const loginId = validateEmail(input.email);
    const displayName = validateName(input.displayName);
    const password = validatePassword(input.password);
    if ((await this.db.by('accounts', 'loginId', loginId)).length > 0) throw new AppError('email-taken');
    const account = await this.buildAccount(role, loginId, displayName, password);
    await this.db.put('accounts', account);
    return account;
  }

  /** Used by the classroom service: creates the sign-in for a new student and returns the PIN once. */
  async buildStudentAccount(displayName: string): Promise<{ account: Account; pin: string }> {
    const pin = randomPin();
    const loginId = await this.freeStudentLogin(displayName);
    return { account: await this.buildAccount('student', loginId, displayName, pin), pin };
  }

  /** New PIN for a student. The caller must have checked that the teacher owns the student. */
  async resetStudentPin(studentId: string): Promise<string> {
    const account = await this.db.get('accounts', studentId);
    if (!account || account.role !== 'student') throw new AppError('not-found');
    const pin = randomPin();
    const salt = newSalt();
    const { verifier } = await deriveSecrets(pin, salt, this.config.iterations);
    await this.db.put('accounts', { ...account, salt, verifier, iterations: this.config.iterations, failedAttempts: 0, lockedUntil: 0 });
    return pin;
  }

  private async buildAccount(role: Role, loginId: string, displayName: string, secret: string): Promise<Account> {
    const salt = newSalt();
    const { verifier } = await deriveSecrets(secret, salt, this.config.iterations);
    return {
      id: uid(),
      role,
      loginId,
      displayName,
      salt,
      iterations: this.config.iterations,
      verifier,
      failedAttempts: 0,
      lockedUntil: 0,
      createdAt: this.config.now(),
    };
  }

  private async freeStudentLogin(displayName: string): Promise<string> {
    // A short, typable login: first name in ASCII when possible, plus three digits.
    const base =
      displayName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .slice(0, 10) || 'lecteur';
    for (let i = 0; i < 50; i++) {
      const candidate = `${base}${Math.floor(100 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 900))}`;
      if ((await this.db.by('accounts', 'loginId', candidate)).length === 0) return candidate;
    }
    return `${base}${uid().slice(0, 6)}`;
  }

  async login(loginIdInput: string, secret: string): Promise<AuthSession> {
    const loginId = loginIdInput.trim().toLowerCase();
    const now = this.config.now();
    const [account] = await this.db.by('accounts', 'loginId', loginId);
    if (!account) {
      await this.audit.record(null, 'login-failed');
      throw new AppError('login-failed');
    }
    if (account.lockedUntil > now) throw new AppError('locked', Math.ceil((account.lockedUntil - now) / 1000));
    if (account.role === 'student') {
      try {
        validatePin(secret);
      } catch {
        throw new AppError('login-failed');
      }
    }

    const { verifier, kek } = await deriveSecrets(secret, account.salt, account.iterations);
    if (!constantTimeEqual(verifier, account.verifier)) {
      const failedAttempts = account.failedAttempts + 1;
      await this.db.put('accounts', { ...account, failedAttempts, lockedUntil: now + lockDelay(failedAttempts) });
      await this.audit.record({ accountId: account.id, role: account.role }, 'login-failed');
      throw new AppError('login-failed');
    }
    if (account.failedAttempts > 0) await this.db.put('accounts', { ...account, failedAttempts: 0, lockedUntil: 0 });

    const session: AuthSession = {
      accountId: account.id,
      role: account.role,
      displayName: account.displayName,
      expiresAt: now + SESSION_MS[account.role],
      // A PIN-derived key protects nothing worth the name, so students get none.
      ...(account.role === 'student' ? {} : { kek }),
    };
    this.session = session;
    await this.db.put('auth', { ...session, id: 'current' });
    await this.audit.record(session, 'login');
    return session;
  }

  async logout(): Promise<void> {
    if (this.session) await this.audit.record(this.session, 'logout');
    this.session = null;
    await this.db.delete('auth', 'current');
  }

  /** Changes an adult's password and re-wraps every student key they hold under the new one. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const session = this.require();
    const account = await this.db.get('accounts', session.accountId);
    if (!account || account.role === 'student' || !session.kek) throw new AppError('forbidden');
    const old = await deriveSecrets(oldPassword, account.salt, account.iterations);
    if (!constantTimeEqual(old.verifier, account.verifier)) throw new AppError('wrong-password');
    validatePassword(newPassword);

    const salt = newSalt();
    const next = await deriveSecrets(newPassword, salt, this.config.iterations);
    const grants = (await this.db.by('grants', 'holderId', account.id)).filter((g) => g.kind === 'account');
    const rewrapped = await Promise.all(
      grants.map(async (g) => ({ ...g, wrapped: await wrapBytes(await unwrapBytes(g.wrapped, old.kek), next.kek) })),
    );
    const updatedSession: AuthSession = { ...session, kek: next.kek };
    await this.db.batch(['accounts', 'grants', 'auth'], (ops) => {
      ops.put('accounts', { ...account, salt, verifier: next.verifier, iterations: this.config.iterations });
      for (const g of rewrapped) ops.put('grants', g);
      ops.put('auth', { ...updatedSession, id: 'current' });
    });
    this.session = updatedSession;
    await this.audit.record(session, 'password-changed');
  }
}
