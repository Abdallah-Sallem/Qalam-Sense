import type { Db } from '@/data/db';
import type { AuditAction, AuditEntry, AuthSession } from '@/domain/types';
import { uid } from '@/lib/ids';

const MAX_ENTRIES = 1000;

/**
 * Local activity log: who did what to whose data, so that a parent can see
 * when their child's records were viewed, exported or deleted. It lives in
 * the same browser storage as everything else and is not tamper-proof.
 */
export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async record(actor: Pick<AuthSession, 'accountId' | 'role'> | null, action: AuditAction, studentId?: string): Promise<void> {
    const entry: AuditEntry = {
      id: uid(),
      at: this.now(),
      actorId: actor?.accountId ?? 'anonymous',
      actorRole: actor?.role ?? 'anonymous',
      action,
      ...(studentId ? { studentId } : {}),
    };
    await this.db.put('audit', entry);
    await this.prune();
  }

  private async prune(): Promise<void> {
    const all = await this.db.all('audit');
    if (all.length <= MAX_ENTRIES) return;
    const excess = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_ENTRIES);
    await this.db.batch(['audit'], (ops) => excess.forEach((e) => ops.delete('audit', e.id)));
  }

  /** Entries about one student, newest first. */
  async forStudent(studentId: string): Promise<AuditEntry[]> {
    return (await this.db.by('audit', 'studentId', studentId)).sort((a, b) => b.at - a.at);
  }
}
