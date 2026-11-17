/**
 * What the reading session itself may do on behalf of the signed-in student:
 * read their own profile and assigned texts, and WRITE session records.
 * It cannot read stored session records: it only holds the public key.
 */
import type { AuthService } from '@/auth/authService';
import type { Db } from '@/data/db';
import type { Baseline } from '@/difficulty/types';
import { CONSENT_POLICY_VERSION, type SessionSummary, type Student, type TextDoc } from '@/domain/types';
import { uid } from '@/lib/ids';
import type { Lang } from '@/reading/text';
import { seal } from '@/security/crypto';
import { AppError } from './errors';

export class StudentService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  async profile(): Promise<Student> {
    const session = this.auth.require('student');
    const student = await this.db.get('students', session.accountId);
    if (!student) throw new AppError('not-found');
    return student;
  }

  async assignedTexts(): Promise<TextDoc[]> {
    const student = await this.profile();
    const texts = await this.db.by('texts', 'teacherId', student.teacherId);
    return texts.filter((t) => t.assignedTo.includes(student.id)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async text(textId: string): Promise<TextDoc> {
    const student = await this.profile();
    const text = await this.db.get('texts', textId);
    if (!text || !text.assignedTo.includes(student.id)) throw new AppError('not-found');
    return text;
  }

  /** True only if a linked parent has given camera consent under the current policy. */
  async cameraAllowed(): Promise<boolean> {
    const student = await this.profile();
    const consent = await this.db.get('consents', student.id);
    return consent?.camera === true && consent.policyVersion === CONSENT_POLICY_VERSION;
  }

  async baseline(language: Lang): Promise<Baseline | null> {
    const student = await this.profile();
    return (await this.db.get('baselines', `${student.id}|${language}`))?.baseline ?? null;
  }

  async saveBaseline(language: Lang, baseline: Baseline): Promise<void> {
    const student = await this.profile();
    await this.db.put('baselines', {
      id: `${student.id}|${language}`,
      studentId: student.id,
      language,
      baseline,
      updatedAt: this.auth.config.now(),
    });
  }

  /** Encrypts the summary to the student's public key and stores it. Returns the record id. */
  async saveSession(summary: SessionSummary): Promise<string> {
    const student = await this.profile();
    // Gaze-derived data is only ever stored with camera consent in force.
    const allowed = await this.cameraAllowed();
    const stored: SessionSummary = allowed ? summary : { ...summary, gaze: null };
    const id = uid();
    await this.db.put('sessions', {
      id,
      studentId: student.id,
      textId: summary.textId,
      startedAt: summary.startedAt,
      sealed: await seal(student.publicKey, stored),
    });
    return id;
  }
}
