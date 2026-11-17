/**
 * Who can decrypt which student's session records.
 *
 * A grant is the student's private key wrapped for one holder. The teacher
 * gets one at creation. A parent gets one by presenting a one-time link code
 * that the teacher handed over: the code proves the relationship (knowing a
 * child's login name is not enough) and carries the key at the same time.
 */
import type { Db } from '@/data/db';
import type { AuthSession, KeyGrant, SessionRecord, SessionSummary } from '@/domain/types';
import { randomCode } from '@/lib/ids';
import { deriveSecrets, importPrivateKey, newSalt, open, unwrapBytes, wrapBytes } from '@/security/crypto';
import { AppError } from './errors';

const grantId = (studentId: string, holderId: string): string => `${studentId}|${holderId}`;
const LINK_HOLDER = 'link-code';
export const LINK_CODE_LENGTH = 8;

export async function accountGrant(studentId: string, holder: AuthSession, privateKey: Uint8Array): Promise<KeyGrant> {
  if (!holder.kek) throw new AppError('forbidden');
  return {
    id: grantId(studentId, holder.accountId),
    studentId,
    holderId: holder.accountId,
    kind: 'account',
    wrapped: await wrapBytes(privateKey, holder.kek),
  };
}

/** Creates the one-time code a parent uses to link the child, and the grant it unlocks. */
export async function linkCodeGrant(
  studentId: string,
  privateKey: Uint8Array,
  iterations: number,
): Promise<{ code: string; grant: KeyGrant }> {
  const code = randomCode(LINK_CODE_LENGTH);
  const salt = newSalt();
  const { kek } = await deriveSecrets(code, salt, iterations);
  return {
    code,
    grant: {
      id: grantId(studentId, LINK_HOLDER),
      studentId,
      holderId: LINK_HOLDER,
      kind: 'link-code',
      wrapped: await wrapBytes(privateKey, kek),
      salt,
      iterations,
    },
  };
}

export const linkGrantId = (studentId: string): string => grantId(studentId, LINK_HOLDER);

/** Recovers the private key bytes from a link code. Throws link-invalid on a wrong or used code. */
export async function redeemLinkCode(db: Db, studentId: string, code: string): Promise<Uint8Array> {
  const grant = await db.get('grants', linkGrantId(studentId));
  if (!grant || grant.kind !== 'link-code' || !grant.salt || !grant.iterations) throw new AppError('link-invalid');
  const normalised = code.trim().toUpperCase().replace(/[\s-]/g, '');
  try {
    const { kek } = await deriveSecrets(normalised, grant.salt, grant.iterations);
    return await unwrapBytes(grant.wrapped, kek);
  } catch {
    throw new AppError('link-invalid');
  }
}

/** The private key bytes of a student, for a holder who has a grant. */
export async function privateKeyBytes(db: Db, session: AuthSession, studentId: string): Promise<Uint8Array> {
  const grant = await db.get('grants', grantId(studentId, session.accountId));
  if (!grant || !session.kek) throw new AppError('forbidden');
  try {
    return await unwrapBytes(grant.wrapped, session.kek);
  } catch {
    throw new AppError('forbidden');
  }
}

export interface DecryptedSession {
  id: string;
  summary: SessionSummary;
}

/** Decrypts session records. Records that cannot be opened are skipped and counted. */
export async function openSessions(
  db: Db,
  session: AuthSession,
  studentId: string,
  records: SessionRecord[],
): Promise<{ sessions: DecryptedSession[]; unreadable: number }> {
  if (records.length === 0) return { sessions: [], unreadable: 0 };
  const key = await importPrivateKey(await privateKeyBytes(db, session, studentId));
  const sessions: DecryptedSession[] = [];
  let unreadable = 0;
  for (const r of records) {
    try {
      sessions.push({ id: r.id, summary: await open<SessionSummary>(key, r.sealed) });
    } catch {
      unreadable++;
    }
  }
  sessions.sort((a, b) => b.summary.startedAt - a.summary.startedAt);
  return { sessions, unreadable };
}
