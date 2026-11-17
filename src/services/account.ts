/** Account-level data rights: delete my account, or wipe this device. */
import type { AuthService } from '@/auth/authService';
import { wipeDatabase, type Db } from '@/data/db';
import { deriveSecrets, constantTimeEqual } from '@/security/crypto';
import { AppError } from './errors';

export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  /**
   * Deletes the signed-in adult's account after re-checking the password.
   * A teacher's students, texts and all their records go with it; a parent's
   * links, key grants and consents go with it.
   */
  async deleteOwnAccount(password: string): Promise<void> {
    const session = this.auth.require();
    const account = await this.db.get('accounts', session.accountId);
    if (!account || account.role === 'student') throw new AppError('forbidden');
    const { verifier } = await deriveSecrets(password, account.salt, account.iterations);
    if (!constantTimeEqual(verifier, account.verifier)) throw new AppError('wrong-password');

    const id = account.id;
    if (account.role === 'teacher') {
      const students = await this.db.by('students', 'teacherId', id);
      await this.db.batch(['accounts', 'students', 'grants', 'links', 'consents', 'sessions', 'baselines', 'audit', 'texts', 'auth'], (ops) => {
        for (const s of students) {
          ops.delete('accounts', s.id);
          ops.delete('students', s.id);
          ops.delete('consents', s.id);
          for (const store of ['grants', 'links', 'sessions', 'baselines', 'audit'] as const) ops.deleteBy(store, 'studentId', s.id);
        }
        ops.deleteBy('texts', 'teacherId', id);
        ops.delete('accounts', id);
        ops.delete('auth', 'current');
      });
    } else {
      const consents = (await this.db.all('consents')).filter((c) => c.parentId === id);
      await this.db.batch(['accounts', 'grants', 'links', 'consents', 'auth'], (ops) => {
        ops.deleteBy('links', 'parentId', id);
        ops.deleteBy('grants', 'holderId', id);
        for (const c of consents) ops.delete('consents', c.studentId);
        ops.delete('accounts', id);
        ops.delete('auth', 'current');
      });
    }
    await this.auth.restore(); // clears the in-memory session
  }

  /** Removes every Qalam-Sense record from this browser, for all users. */
  async wipeDevice(): Promise<void> {
    this.auth.require();
    this.db.close();
    await wipeDatabase();
  }
}
