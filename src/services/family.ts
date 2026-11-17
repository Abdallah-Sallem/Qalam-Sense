/**
 * Parent operations: linking a child, consent, viewing progress, deleting data.
 * A parent can only ever touch children they have linked with a valid code.
 */
import type { AuthService } from '@/auth/authService';
import type { Db } from '@/data/db';
import { CONSENT_POLICY_VERSION, type AuditEntry, type AuthSession, type Consent, type Student } from '@/domain/types';
import type { AuditLog } from './audit';
import { AppError } from './errors';
import { accountGrant, linkGrantId, openSessions, redeemLinkCode, type DecryptedSession } from './keyring';

export interface ChildRow {
  student: Student;
  consent: Consent | null;
  sessionCount: number;
}

const linkId = (parentId: string, studentId: string): string => `${parentId}|${studentId}`;

export class FamilyService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: AuditLog,
  ) {}

  private parent(): AuthSession {
    return this.auth.require('parent');
  }

  private async ownChild(studentId: string): Promise<{ parent: AuthSession; student: Student }> {
    const parent = this.parent();
    const [link, student] = await Promise.all([
      this.db.get('links', linkId(parent.accountId, studentId)),
      this.db.get('students', studentId),
    ]);
    if (!link || !student) throw new AppError('forbidden');
    return { parent, student };
  }

  /**
   * Links a child using the child's login name and the one-time code from the
   * teacher. The same error is returned for an unknown login and a wrong code,
   * so the form cannot be used to find out which logins exist.
   */
  async linkChild(studentLogin: string, code: string): Promise<Student> {
    const parent = this.parent();
    const [account] = await this.db.by('accounts', 'loginId', studentLogin.trim().toLowerCase());
    const student = account?.role === 'student' ? await this.db.get('students', account.id) : undefined;
    if (!student) throw new AppError('link-invalid');
    if (await this.db.get('links', linkId(parent.accountId, student.id))) throw new AppError('already-linked');

    const privateKey = await redeemLinkCode(this.db, student.id, code);
    const grant = await accountGrant(student.id, parent, privateKey);
    await this.db.batch(['links', 'grants'], (ops) => {
      ops.put('links', { id: linkId(parent.accountId, student.id), parentId: parent.accountId, studentId: student.id, linkedAt: this.auth.config.now() });
      ops.put('grants', grant);
      ops.delete('grants', linkGrantId(student.id)); // the code is single-use
    });
    await this.audit.record(parent, 'child-linked', student.id);
    return student;
  }

  async children(): Promise<ChildRow[]> {
    const parent = this.parent();
    const links = await this.db.by('links', 'parentId', parent.accountId);
    const rows = await Promise.all(
      links.map(async (l): Promise<ChildRow | null> => {
        const student = await this.db.get('students', l.studentId);
        if (!student) return null;
        const [consent, sessions] = await Promise.all([this.db.get('consents', student.id), this.db.by('sessions', 'studentId', student.id)]);
        return { student, consent: consent ?? null, sessionCount: sessions.length };
      }),
    );
    return rows.filter((r): r is ChildRow => r !== null).sort((a, b) => a.student.displayName.localeCompare(b.student.displayName));
  }

  /** Grants or withdraws permission to use the camera during this child's reading. */
  async setCameraConsent(studentId: string, camera: boolean): Promise<Consent | null> {
    const { parent } = await this.ownChild(studentId);
    if (!camera) {
      await this.db.delete('consents', studentId);
      await this.audit.record(parent, 'consent-revoked', studentId);
      return null;
    }
    const consent: Consent = {
      studentId,
      parentId: parent.accountId,
      camera: true,
      grantedAt: this.auth.config.now(),
      policyVersion: CONSENT_POLICY_VERSION,
    };
    await this.db.put('consents', consent);
    await this.audit.record(parent, 'consent-granted', studentId);
    return consent;
  }

  async sessions(studentId: string): Promise<{ sessions: DecryptedSession[]; unreadable: number }> {
    const { parent } = await this.ownChild(studentId);
    return openSessions(this.db, parent, studentId, await this.db.by('sessions', 'studentId', studentId));
  }

  /** Who viewed, exported or deleted this child's records, newest first. */
  async activity(studentId: string): Promise<AuditEntry[]> {
    await this.ownChild(studentId);
    return this.audit.forStudent(studentId);
  }

  /**
   * Deletes every reading record and the learned reading baseline of the
   * child from this device. Returns how many session records were removed.
   */
  async deleteChildData(studentId: string): Promise<number> {
    const { parent } = await this.ownChild(studentId);
    const count = (await this.db.by('sessions', 'studentId', studentId)).length;
    await this.db.batch(['sessions', 'baselines'], (ops) => {
      ops.deleteBy('sessions', 'studentId', studentId);
      ops.deleteBy('baselines', 'studentId', studentId);
    });
    await this.audit.record(parent, 'sessions-deleted', studentId);
    return count;
  }

  /** Removes the link. Consent given by this parent is withdrawn with it. */
  async unlinkChild(studentId: string): Promise<void> {
    const { parent } = await this.ownChild(studentId);
    const consent = await this.db.get('consents', studentId);
    await this.db.batch(['links', 'grants', 'consents'], (ops) => {
      ops.delete('links', linkId(parent.accountId, studentId));
      ops.delete('grants', `${studentId}|${parent.accountId}`);
      if (consent?.parentId === parent.accountId) ops.delete('consents', studentId);
    });
    await this.audit.record(parent, 'child-unlinked', studentId);
  }
}
