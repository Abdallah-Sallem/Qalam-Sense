/**
 * Teacher operations. Every method checks that the caller is a signed-in
 * teacher AND owns the student or text it touches.
 */
import { DEFAULT_SETTINGS, type StudentSettings } from '@/adaptation/types';
import type { AuthService } from '@/auth/authService';
import type { Db } from '@/data/db';
import type { TextDifficulty } from '@/difficulty/types';
import type { AuthSession, Student, TextDoc } from '@/domain/types';
import { uid } from '@/lib/ids';
import { detectLanguage } from '@/reading/text';
import { generateStudentKeyPair } from '@/security/crypto';
import { validateAge, validateLanguage, validateName, validateTextContent, validateTitle } from '@/security/validation';
import type { AuditLog } from './audit';
import { AppError } from './errors';
import { accountGrant, linkCodeGrant, openSessions, privateKeyBytes, type DecryptedSession } from './keyring';

export interface StudentCredentials {
  student: Student;
  loginId: string;
  /** Shown once; only a verifier is stored. */
  pin: string;
  /** One-time code for the parent. */
  linkCode: string;
}

export interface StudentRow {
  student: Student;
  loginId: string;
  sessionCount: number;
  lastSessionAt: number | null;
  parentLinked: boolean;
  cameraConsent: boolean;
}

const clampLevel = (v: number): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.round(v))) as 0 | 1 | 2 | 3;

export function sanitizeSettings(input: Partial<StudentSettings>, base: StudentSettings = DEFAULT_SETTINGS): StudentSettings {
  const s = { ...base, ...input };
  const baseLevel = clampLevel(s.baseLevel);
  return {
    autoAdapt: Boolean(s.autoAdapt),
    baseLevel,
    maxLevel: clampLevel(Math.max(s.maxLevel, baseLevel)),
    font: (['auto', 'atkinson', 'lexend', 'opendyslexic'] as const).includes(s.font) ? s.font : 'auto',
    theme: (['auto', 'paper', 'cream', 'sky', 'dusk'] as const).includes(s.theme) ? s.theme : 'auto',
    syllableColoring: Boolean(s.syllableColoring),
  };
}

export class ClassroomService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: AuditLog,
  ) {}

  private teacher(): AuthSession {
    return this.auth.require('teacher');
  }

  private async ownStudent(studentId: string): Promise<{ teacher: AuthSession; student: Student }> {
    const teacher = this.teacher();
    const student = await this.db.get('students', studentId);
    if (!student) throw new AppError('not-found');
    if (student.teacherId !== teacher.accountId) throw new AppError('forbidden');
    return { teacher, student };
  }

  private async ownText(textId: string): Promise<TextDoc> {
    const teacher = this.teacher();
    const text = await this.db.get('texts', textId);
    if (!text) throw new AppError('not-found');
    if (text.teacherId !== teacher.accountId) throw new AppError('forbidden');
    return text;
  }

  // ── Students ────────────────────────────────────────────────────────────

  async createStudent(input: { displayName: string; age: number; language: string }): Promise<StudentCredentials> {
    const teacher = this.teacher();
    const displayName = validateName(input.displayName);
    const age = validateAge(input.age);
    const language = validateLanguage(input.language);

    const { account, pin } = await this.auth.buildStudentAccount(displayName);
    const keys = await generateStudentKeyPair();
    const student: Student = {
      id: account.id,
      teacherId: teacher.accountId,
      displayName,
      age,
      language,
      settings: DEFAULT_SETTINGS,
      publicKey: keys.publicKey,
      createdAt: this.auth.config.now(),
    };
    const [teacherGrant, link] = await Promise.all([
      accountGrant(student.id, teacher, keys.privateKey),
      linkCodeGrant(student.id, keys.privateKey, this.auth.config.iterations),
    ]);
    await this.db.batch(['accounts', 'students', 'grants'], (ops) => {
      ops.put('accounts', account);
      ops.put('students', student);
      ops.put('grants', teacherGrant);
      ops.put('grants', link.grant);
    });
    await this.audit.record(teacher, 'student-created', student.id);
    return { student, loginId: account.loginId, pin, linkCode: link.code };
  }

  async listStudents(): Promise<StudentRow[]> {
    const teacher = this.teacher();
    const students = await this.db.by('students', 'teacherId', teacher.accountId);
    const rows = await Promise.all(
      students.map(async (student): Promise<StudentRow> => {
        const [account, sessions, links, consent] = await Promise.all([
          this.db.get('accounts', student.id),
          this.db.by('sessions', 'studentId', student.id),
          this.db.by('links', 'studentId', student.id),
          this.db.get('consents', student.id),
        ]);
        return {
          student,
          loginId: account?.loginId ?? '',
          sessionCount: sessions.length,
          lastSessionAt: sessions.length ? Math.max(...sessions.map((s) => s.startedAt)) : null,
          parentLinked: links.length > 0,
          cameraConsent: consent?.camera === true,
        };
      }),
    );
    return rows.sort((a, b) => a.student.displayName.localeCompare(b.student.displayName));
  }

  async updateStudent(
    studentId: string,
    patch: { displayName?: string; age?: number; language?: string; settings?: Partial<StudentSettings> },
  ): Promise<Student> {
    const { student } = await this.ownStudent(studentId);
    const next: Student = {
      ...student,
      ...(patch.displayName !== undefined ? { displayName: validateName(patch.displayName) } : {}),
      ...(patch.age !== undefined ? { age: validateAge(patch.age) } : {}),
      ...(patch.language !== undefined ? { language: validateLanguage(patch.language) } : {}),
      ...(patch.settings ? { settings: sanitizeSettings(patch.settings, student.settings) } : {}),
    };
    const account = await this.db.get('accounts', studentId);
    await this.db.batch(['students', 'accounts'], (ops) => {
      ops.put('students', next);
      if (account && account.displayName !== next.displayName) ops.put('accounts', { ...account, displayName: next.displayName });
    });
    return next;
  }

  async resetPin(studentId: string): Promise<string> {
    const { teacher } = await this.ownStudent(studentId);
    const pin = await this.auth.resetStudentPin(studentId);
    await this.audit.record(teacher, 'pin-reset', studentId);
    return pin;
  }

  /** Issues a fresh one-time parent code (the previous unused one stops working). */
  async issueLinkCode(studentId: string): Promise<string> {
    const { teacher } = await this.ownStudent(studentId);
    const privateKey = await privateKeyBytes(this.db, teacher, studentId);
    const { code, grant } = await linkCodeGrant(studentId, privateKey, this.auth.config.iterations);
    await this.db.put('grants', grant);
    await this.audit.record(teacher, 'link-code-issued', studentId);
    return code;
  }

  /** Deletes the student and everything attached to them. Irreversible. */
  async deleteStudent(studentId: string): Promise<void> {
    const { teacher } = await this.ownStudent(studentId);
    const texts = (await this.db.by('texts', 'teacherId', teacher.accountId)).filter((t) => t.assignedTo.includes(studentId));
    await this.db.batch(['accounts', 'students', 'grants', 'links', 'consents', 'sessions', 'baselines', 'audit', 'texts'], (ops) => {
      ops.delete('accounts', studentId);
      ops.delete('students', studentId);
      ops.delete('consents', studentId);
      for (const store of ['grants', 'links', 'sessions', 'baselines', 'audit'] as const) ops.deleteBy(store, 'studentId', studentId);
      for (const t of texts) ops.put('texts', { ...t, assignedTo: t.assignedTo.filter((id) => id !== studentId) });
    });
    // Recorded without the student id: nothing about the deleted child remains.
    await this.audit.record(teacher, 'student-deleted');
  }

  // ── Reading material ────────────────────────────────────────────────────

  async saveText(input: { id?: string; title: string; content: string; difficulty: TextDifficulty }): Promise<TextDoc> {
    const teacher = this.teacher();
    const title = validateTitle(input.title);
    const content = validateTextContent(input.content);
    if (!['facile', 'moyen', 'difficile'].includes(input.difficulty)) throw new AppError('forbidden');
    const existing = input.id ? await this.ownText(input.id) : null;
    const text: TextDoc = {
      id: existing?.id ?? uid(),
      teacherId: teacher.accountId,
      title,
      content,
      language: detectLanguage(content),
      difficulty: input.difficulty,
      assignedTo: existing?.assignedTo ?? [],
      createdAt: existing?.createdAt ?? this.auth.config.now(),
    };
    await this.db.put('texts', text);
    return text;
  }

  async listTexts(): Promise<TextDoc[]> {
    const teacher = this.teacher();
    return (await this.db.by('texts', 'teacherId', teacher.accountId)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async assignText(textId: string, studentIds: string[]): Promise<TextDoc> {
    const text = await this.ownText(textId);
    const mine = new Set((await this.db.by('students', 'teacherId', text.teacherId)).map((s) => s.id));
    const assignedTo = [...new Set(studentIds)].filter((id) => mine.has(id));
    const next = { ...text, assignedTo };
    await this.db.put('texts', next);
    return next;
  }

  async deleteText(textId: string): Promise<void> {
    await this.ownText(textId);
    await this.db.delete('texts', textId);
  }

  // ── Session data ────────────────────────────────────────────────────────

  async sessions(studentId: string): Promise<{ sessions: DecryptedSession[]; unreadable: number }> {
    const { teacher } = await this.ownStudent(studentId);
    const records = await this.db.by('sessions', 'studentId', studentId);
    const result = await openSessions(this.db, teacher, studentId, records);
    await this.audit.record(teacher, 'sessions-viewed', studentId);
    return result;
  }

  async noteExport(studentId: string): Promise<void> {
    const { teacher } = await this.ownStudent(studentId);
    await this.audit.record(teacher, 'sessions-exported', studentId);
  }

  async deleteSession(studentId: string, sessionId: string): Promise<void> {
    const { teacher } = await this.ownStudent(studentId);
    const record = await this.db.get('sessions', sessionId);
    if (!record || record.studentId !== studentId) throw new AppError('not-found');
    await this.db.delete('sessions', sessionId);
    await this.audit.record(teacher, 'sessions-deleted', studentId);
  }
}
