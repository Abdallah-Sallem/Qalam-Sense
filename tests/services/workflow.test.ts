/**
 * Integration: accounts, roles, key grants, consent, persistence and
 * deletion, against a real (in-memory) IndexedDB and real Web Crypto.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NO_MANUAL } from '@/adaptation/types';
import { LOCKOUT, lockDelay } from '@/auth/authService';
import { Db, wipeDatabase } from '@/data/db';
import type { SessionSummary } from '@/domain/types';
import { parseText } from '@/reading/text';
import { ValidationError } from '@/security/validation';
import { createServices, type Services } from '@/services';
import { AppError } from '@/services/errors';
import { effortfulPassages, mainIndicators, overview, pace, sessionsToCsv, trend } from '@/services/reports';

let clock = 1_800_000_000_000;
let dbName = '';
let n = 0;

async function fresh(): Promise<Services> {
  dbName = `qalam-test-${++n}`;
  return createServices(await Db.open(dbName), { iterations: 1000, now: () => clock });
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof AppError || e instanceof ValidationError) return e.code;
    throw e;
  }
};

const TEACHER = { email: 'prof@ecole.tn', password: 'lecture-2026', displayName: 'Mme Trabelsi' };
const PARENT = { email: 'parent@mail.tn', password: 'maison-2026', displayName: 'M. Ben Salah' };
const TEXT = { title: 'Le lion et le rat', content: 'Un lion dormait. Un rat le réveilla.\n\nLe lion le laissa partir.', difficulty: 'moyen' as const };

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    textId: 't1',
    textTitle: TEXT.title,
    language: 'fr',
    startedAt: clock,
    durationMs: 95_000,
    endReason: 'completed',
    wordsTotal: 12,
    wordsRead: 12,
    paragraphs: [
      { index: 0, words: 7, timeMs: 50_000 },
      { index: 1, words: 5, timeMs: 40_000 },
    ],
    camera: 'used',
    finalLevel: 1,
    adaptations: [{ atMs: 40_000, trigger: 'auto', fromLevel: 0, toLevel: 1, dominant: 'decoding', reasons: ['prolongedFixations'], confidence: 0.8 }],
    manual: NO_MANUAL,
    gaze: {
      calibration: { grade: 'good', meanErrorPx: 48, relativeError: 0.04 },
      tracking: { validRatio: 0.91, lossEvents: 1, blinkRate: 14, recalibrations: 0 },
      totals: { fixations: 120, regressions: 18, onTextMs: 80_000 },
      assessments: { ok: 14, insufficient: 2, meanNeed: 0.31, peakNeed: 0.62 },
      indicatorMeans: { prolongedFixations: 0.45, frequentRegressions: 0.3, offText: 0.02 },
      timeline: [{ atMs: 20_000, need: 0.2, confidence: 0.9 }],
      sentences: [
        { sentence: 0, dwellMs: 3000, fixations: 8, regressionsIn: 0 },
        { sentence: 1, dwellMs: 9000, fixations: 14, regressionsIn: 3 },
        { sentence: 2, dwellMs: 4000, fixations: 9, regressionsIn: 0 },
      ],
    },
    ...over,
  };
}

/** Teacher with one student and one assigned text; returns to signed-out state. */
async function seed(s: Services) {
  await s.auth.registerAdult('teacher', TEACHER);
  await s.auth.login(TEACHER.email, TEACHER.password);
  const creds = await s.classroom.createStudent({ displayName: 'Amine', age: 9, language: 'fr' });
  const text = await s.classroom.saveText(TEXT);
  await s.classroom.assignText(text.id, [creds.student.id]);
  await s.auth.logout();
  return { creds, text };
}

beforeEach(() => {
  clock += 86_400_000;
});

describe('accounts and sign-in', () => {
  it('registers adults with validated input and unique e-mail', async () => {
    const s = await fresh();
    const account = await s.auth.registerAdult('teacher', { ...TEACHER, email: ' PROF@ecole.tn ' });
    expect(account.loginId).toBe('prof@ecole.tn');
    expect(JSON.stringify(account)).not.toContain(TEACHER.password);
    expect(await codeOf(s.auth.registerAdult('parent', TEACHER))).toBe('email-taken');
    expect(await codeOf(s.auth.registerAdult('parent', { ...PARENT, password: 'short' }))).toBe('password-too-short');
    expect(await codeOf(s.auth.registerAdult('parent', { ...PARENT, email: 'nope' }))).toBe('email-invalid');
  });

  it('signs in with the right password only, with the same error for unknown users', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    expect(await codeOf(s.auth.login(TEACHER.email, 'wrong-password'))).toBe('login-failed');
    expect(await codeOf(s.auth.login('nobody@ecole.tn', TEACHER.password))).toBe('login-failed');
    const session = await s.auth.login(TEACHER.email.toUpperCase(), TEACHER.password);
    expect(session).toMatchObject({ role: 'teacher', displayName: 'Mme Trabelsi' });
    expect(session.kek?.extractable).toBe(false);
  });

  it('locks the account for a growing delay after repeated failures', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    for (let i = 0; i < LOCKOUT.freeAttempts; i++) expect(await codeOf(s.auth.login(TEACHER.email, 'wrong-password'))).toBe('login-failed');
    // Even the right password is refused while locked.
    expect(await codeOf(s.auth.login(TEACHER.email, TEACHER.password))).toBe('locked');
    clock += LOCKOUT.baseMs + 1;
    expect(await codeOf(s.auth.login(TEACHER.email, 'wrong-password'))).toBe('login-failed');
    expect(await codeOf(s.auth.login(TEACHER.email, TEACHER.password))).toBe('locked');
    clock += 2 * LOCKOUT.baseMs + 1;
    expect(await codeOf(s.auth.login(TEACHER.email, TEACHER.password))).toBe('ok');
    // A success clears the counter.
    await s.auth.logout();
    expect(await codeOf(s.auth.login(TEACHER.email, 'wrong-password'))).toBe('login-failed');
    expect(await codeOf(s.auth.login(TEACHER.email, TEACHER.password))).toBe('ok');
    expect(lockDelay(4)).toBe(0);
    expect(lockDelay(50)).toBe(LOCKOUT.maxMs);
  });

  it('restores the session after a page refresh, until it expires', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    await s.auth.login(TEACHER.email, TEACHER.password);
    const creds = await s.classroom.createStudent({ displayName: 'Amine', age: 9, language: 'fr' });

    // New page load: new service objects over the same database.
    const reloaded = createServices(await Db.open(dbName), { iterations: 1000, now: () => clock });
    expect(reloaded.auth.current()).toBeNull();
    expect((await reloaded.auth.restore())?.role).toBe('teacher');
    // The key survived the reload: session data is still readable.
    expect((await reloaded.classroom.sessions(creds.student.id)).sessions).toEqual([]);

    clock += 9 * 3600_000;
    expect(reloaded.auth.current()).toBeNull();
    expect(await reloaded.auth.restore()).toBeNull();
    expect(await codeOf(reloaded.classroom.listStudents())).toBe('not-signed-in');
  });

  it('signs out', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    await s.auth.login(TEACHER.email, TEACHER.password);
    await s.auth.logout();
    expect(s.auth.current()).toBeNull();
    expect(await s.auth.restore()).toBeNull();
  });
});

describe('teacher workflow', () => {
  it('creates a student with typable credentials shown once', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    expect(creds.loginId).toMatch(/^amine\d{3}$/);
    expect(creds.pin).toMatch(/^\d{4}$/);
    expect(creds.linkCode).toMatch(/^[A-Z2-9]{8}$/);
    // Neither the PIN nor the link code is stored anywhere in clear.
    const dump = JSON.stringify(await Promise.all((['accounts', 'students', 'grants'] as const).map((st) => s.db.all(st))));
    expect(dump).not.toContain(creds.linkCode);
    expect(dump).not.toContain(`"${creds.pin}"`);
  });

  it('gives Arabic names a usable login', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    await s.auth.login(TEACHER.email, TEACHER.password);
    const creds = await s.classroom.createStudent({ displayName: 'أمين', age: 8, language: 'ar' });
    expect(creds.loginId).toMatch(/^lecteur\d{3}$/);
    expect(creds.student.language).toBe('ar');
  });

  it('validates student input and settings', async () => {
    const s = await fresh();
    await s.auth.registerAdult('teacher', TEACHER);
    await s.auth.login(TEACHER.email, TEACHER.password);
    expect(await codeOf(s.classroom.createStudent({ displayName: '', age: 9, language: 'fr' }))).toBe('name-required');
    expect(await codeOf(s.classroom.createStudent({ displayName: 'A', age: 40, language: 'fr' }))).toBe('age-invalid');
    expect(await codeOf(s.classroom.createStudent({ displayName: 'A', age: 9, language: 'en' }))).toBe('language-invalid');
    const { student } = await s.classroom.createStudent({ displayName: 'Sara', age: 10, language: 'fr' });
    const updated = await s.classroom.updateStudent(student.id, { settings: { baseLevel: 2, maxLevel: 1, font: 'evil' as never } });
    expect(updated.settings).toMatchObject({ baseLevel: 2, maxLevel: 2, font: 'auto' });
  });

  it('manages texts: language detection, assignment limited to own students, deletion', async () => {
    const s = await fresh();
    const { creds, text } = await seed(s);
    await s.auth.login(TEACHER.email, TEACHER.password);
    expect(text.language).toBe('fr');
    const arabic = await s.classroom.saveText({ title: 'الأسد والفأر', content: 'كان الأسد نائما.', difficulty: 'facile' });
    expect(arabic.language).toBe('ar');
    const assigned = await s.classroom.assignText(arabic.id, [creds.student.id, creds.student.id, 'someone-else']);
    expect(assigned.assignedTo).toEqual([creds.student.id]);
    const edited = await s.classroom.saveText({ id: text.id, title: 'Le lion', content: TEXT.content, difficulty: 'difficile' });
    expect(edited).toMatchObject({ id: text.id, title: 'Le lion', assignedTo: [creds.student.id] });
    await s.classroom.deleteText(arabic.id);
    expect((await s.classroom.listTexts()).map((t) => t.id)).toEqual([text.id]);
    expect(await codeOf(s.classroom.saveText({ title: 'x', content: '', difficulty: 'moyen' }))).toBe('text-empty');
  });

  it('resets a PIN: the old one stops working', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    await s.auth.login(TEACHER.email, TEACHER.password);
    const pin = await s.classroom.resetPin(creds.student.id);
    await s.auth.logout();
    if (pin !== creds.pin) expect(await codeOf(s.auth.login(creds.loginId, creds.pin))).toBe('login-failed');
    expect(await codeOf(s.auth.login(creds.loginId, pin))).toBe('ok');
  });
});

describe('full journey: teacher → parent → student → teacher', () => {
  it('links, consents, reads, stores encrypted, and lets the right adults read it back', async () => {
    const s = await fresh();
    const { creds, text } = await seed(s);

    // Parent: link with the one-time code, then consent to the camera.
    await s.auth.registerAdult('parent', PARENT);
    await s.auth.login(PARENT.email, PARENT.password);
    expect(await codeOf(s.family.linkChild(creds.loginId, 'WRONGCOD'))).toBe('link-invalid');
    expect(await codeOf(s.family.linkChild('nobody123', creds.linkCode))).toBe('link-invalid');
    const child = await s.family.linkChild(creds.loginId.toUpperCase(), ` ${creds.linkCode.toLowerCase().slice(0, 4)}-${creds.linkCode.slice(4)} `);
    expect(child.id).toBe(creds.student.id);
    expect(await codeOf(s.family.linkChild(creds.loginId, creds.linkCode))).toBe('already-linked');
    expect((await s.family.children())[0]!.consent).toBeNull();
    await s.family.setCameraConsent(child.id, true);
    await s.auth.logout();

    // Student: signs in with the PIN, sees the assigned text, saves a session.
    const session = await s.auth.login(creds.loginId, creds.pin);
    expect(session.kek).toBeUndefined();
    expect((await s.student.assignedTexts()).map((t) => t.id)).toEqual([text.id]);
    expect(await s.student.cameraAllowed()).toBe(true);
    expect(await s.student.baseline('fr')).toBeNull();
    await s.student.saveBaseline('fr', { fixationMs: 400, wordsPerMinute: 80, fixationCv: 0.4, windows: 4 });
    expect((await s.student.baseline('fr'))!.fixationMs).toBe(400);
    const id = await s.student.saveSession(summary({ textId: text.id }));

    // At rest the record is ciphertext.
    const stored = await s.db.get('sessions', id);
    expect(JSON.stringify(stored)).not.toMatch(/lion|prolongedFixations|validRatio/);
    // The student's own session cannot use adult services.
    expect(await codeOf(s.classroom.sessions(creds.student.id))).toBe('forbidden');
    expect(await codeOf(s.family.sessions(creds.student.id))).toBe('forbidden');
    await s.auth.logout();

    // Teacher reads it back.
    await s.auth.login(TEACHER.email, TEACHER.password);
    const forTeacher = await s.classroom.sessions(creds.student.id);
    expect(forTeacher.unreadable).toBe(0);
    expect(forTeacher.sessions[0]!.summary).toMatchObject({ textTitle: TEXT.title, wordsRead: 12, camera: 'used' });
    expect(forTeacher.sessions[0]!.summary.gaze!.assessments.meanNeed).toBe(0.31);
    const [row] = await s.classroom.listStudents();
    expect(row).toMatchObject({ sessionCount: 1, parentLinked: true, cameraConsent: true });
    await s.auth.logout();

    // Parent reads it back too, and sees who looked at the records.
    await s.auth.login(PARENT.email, PARENT.password);
    expect((await s.family.sessions(creds.student.id)).sessions).toHaveLength(1);
    const actions = (await s.family.activity(creds.student.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['student-created', 'child-linked', 'consent-granted', 'sessions-viewed']));
  });

  it('drops gaze data when camera consent is not in force', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    await s.auth.login(creds.loginId, creds.pin);
    expect(await s.student.cameraAllowed()).toBe(false);
    await s.student.saveSession(summary());
    await s.auth.logout();
    await s.auth.login(TEACHER.email, TEACHER.password);
    const { sessions } = await s.classroom.sessions(creds.student.id);
    expect(sessions[0]!.summary.gaze).toBeNull();
    expect(sessions[0]!.summary.paragraphs).toHaveLength(2); // non-camera data is kept
  });

  it('withdraws consent, and a new link code replaces an unused one', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    await s.auth.login(TEACHER.email, TEACHER.password);
    const second = await s.classroom.issueLinkCode(creds.student.id);
    await s.auth.logout();
    await s.auth.registerAdult('parent', PARENT);
    await s.auth.login(PARENT.email, PARENT.password);
    expect(await codeOf(s.family.linkChild(creds.loginId, creds.linkCode))).toBe('link-invalid');
    await s.family.linkChild(creds.loginId, second);
    await s.family.setCameraConsent(creds.student.id, true);
    expect(await s.family.setCameraConsent(creds.student.id, false)).toBeNull();
    await s.auth.logout();
    await s.auth.login(creds.loginId, creds.pin);
    expect(await s.student.cameraAllowed()).toBe(false);
  });
});

describe('access control', () => {
  it('refuses every cross-tenant and cross-role operation', async () => {
    const s = await fresh();
    const { creds, text } = await seed(s);

    // Another teacher on the same device.
    await s.auth.registerAdult('teacher', { email: 'autre@ecole.tn', password: 'autre-classe-1', displayName: 'M. Autre' });
    await s.auth.login('autre@ecole.tn', 'autre-classe-1');
    expect(await s.classroom.listStudents()).toEqual([]);
    expect(await s.classroom.listTexts()).toEqual([]);
    for (const attempt of [
      () => s.classroom.sessions(creds.student.id),
      () => s.classroom.updateStudent(creds.student.id, { age: 12 }),
      () => s.classroom.resetPin(creds.student.id),
      () => s.classroom.issueLinkCode(creds.student.id),
      () => s.classroom.deleteStudent(creds.student.id),
      () => s.classroom.assignText(text.id, []),
      () => s.classroom.deleteText(text.id),
    ]) {
      expect(await codeOf(attempt())).toBe('forbidden');
    }
    await s.auth.logout();

    // A parent who has not linked the child.
    await s.auth.registerAdult('parent', PARENT);
    await s.auth.login(PARENT.email, PARENT.password);
    for (const attempt of [
      () => s.family.sessions(creds.student.id),
      () => s.family.setCameraConsent(creds.student.id, true),
      () => s.family.deleteChildData(creds.student.id),
      () => s.family.activity(creds.student.id),
      () => s.classroom.listStudents(),
      () => s.student.profile(),
    ]) {
      expect(await codeOf(attempt())).toBe('forbidden');
    }
    await s.auth.logout();

    // Nobody signed in.
    expect(await codeOf(s.classroom.createStudent({ displayName: 'X', age: 9, language: 'fr' }))).toBe('not-signed-in');
    expect(await codeOf(s.student.assignedTexts())).toBe('not-signed-in');

    // A student cannot open a text that is not assigned to them.
    await s.auth.login(TEACHER.email, TEACHER.password);
    const other = await s.classroom.saveText({ title: 'Autre', content: 'Texte non assigné.', difficulty: 'moyen' });
    await s.auth.logout();
    await s.auth.login(creds.loginId, creds.pin);
    expect(await codeOf(s.student.text(other.id))).toBe('not-found');
    expect((await s.student.text(text.id)).title).toBe(TEXT.title);
  });

  it('keeps session records unreadable to an adult without a key grant, even with database access', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    await s.auth.login(creds.loginId, creds.pin);
    await s.student.saveSession(summary());
    await s.auth.logout();
    await s.auth.registerAdult('teacher', { email: 'autre@ecole.tn', password: 'autre-classe-1', displayName: 'M. Autre' });
    const intruder = await s.auth.login('autre@ecole.tn', 'autre-classe-1');
    // Bypass the service layer entirely and try the cryptography directly.
    const { openSessions } = await import('@/services/keyring');
    const records = await s.db.by('sessions', 'studentId', creds.student.id);
    expect(await codeOf(openSessions(s.db, intruder, creds.student.id, records))).toBe('forbidden');
  });
});

describe('password change', () => {
  it('keeps access to student records and invalidates the old password', async () => {
    const s = await fresh();
    const { creds } = await seed(s);
    await s.auth.login(creds.loginId, creds.pin);
    await s.student.saveSession(summary());
    await s.auth.logout();

    await s.auth.login(TEACHER.email, TEACHER.password);
    expect(await codeOf(s.auth.changePassword('not-the-password', 'nouveau-passe-9'))).toBe('wrong-password');
    expect(await codeOf(s.auth.changePassword(TEACHER.password, 'short'))).toBe('password-too-short');
    await s.auth.changePassword(TEACHER.password, 'nouveau-passe-9');
    expect((await s.classroom.sessions(creds.student.id)).sessions).toHaveLength(1); // same session, re-wrapped key
    await s.auth.logout();

    expect(await codeOf(s.auth.login(TEACHER.email, TEACHER.password))).toBe('login-failed');
    await s.auth.login(TEACHER.email, 'nouveau-passe-9');
    expect((await s.classroom.sessions(creds.student.id)).sessions).toHaveLength(1);
  });
});

describe('deletion', () => {
  async function withSessions(s: Services) {
    const seeded = await seed(s);
    await s.auth.registerAdult('parent', PARENT);
    await s.auth.login(PARENT.email, PARENT.password);
    await s.family.linkChild(seeded.creds.loginId, seeded.creds.linkCode);
    await s.family.setCameraConsent(seeded.creds.student.id, true);
    await s.auth.logout();
    await s.auth.login(seeded.creds.loginId, seeded.creds.pin);
    await s.student.saveSession(summary());
    await s.student.saveSession(summary({ startedAt: clock + 1000 }));
    await s.student.saveBaseline('fr', { fixationMs: 400, wordsPerMinute: 80, fixationCv: 0.4, windows: 4 });
    await s.auth.logout();
    return seeded;
  }

  it('lets a parent delete the child’s reading records for real', async () => {
    const s = await fresh();
    const { creds } = await withSessions(s);
    await s.auth.login(PARENT.email, PARENT.password);
    expect(await s.family.deleteChildData(creds.student.id)).toBe(2);
    expect(await s.db.by('sessions', 'studentId', creds.student.id)).toEqual([]);
    expect(await s.db.by('baselines', 'studentId', creds.student.id)).toEqual([]);
    expect((await s.family.sessions(creds.student.id)).sessions).toEqual([]);
    // The child, the link and the consent are untouched.
    expect((await s.family.children())[0]).toMatchObject({ sessionCount: 0, consent: { camera: true } });
  });

  it('lets a teacher delete one session, or a student with everything attached', async () => {
    const s = await fresh();
    const { creds, text } = await withSessions(s);
    await s.auth.login(TEACHER.email, TEACHER.password);
    const { sessions } = await s.classroom.sessions(creds.student.id);
    await s.classroom.deleteSession(creds.student.id, sessions[0]!.id);
    expect((await s.classroom.sessions(creds.student.id)).sessions).toHaveLength(1);
    expect(await codeOf(s.classroom.deleteSession(creds.student.id, 'missing'))).toBe('not-found');

    await s.classroom.deleteStudent(creds.student.id);
    for (const store of ['students', 'sessions', 'grants', 'links', 'consents', 'baselines'] as const) {
      const left = (await s.db.all(store)).filter((r) => JSON.stringify(r).includes(creds.student.id));
      expect(left, store).toEqual([]);
    }
    expect(await s.db.get('accounts', creds.student.id)).toBeUndefined();
    expect((await s.db.get('texts', text.id))!.assignedTo).toEqual([]);
    expect((await s.db.all('audit')).some((a) => a.studentId === creds.student.id)).toBe(false);
    await s.auth.logout();
    expect(await codeOf(s.auth.login(creds.loginId, creds.pin))).toBe('login-failed');
  });

  it('unlinking removes the parent’s key and the consent they gave', async () => {
    const s = await fresh();
    const { creds } = await withSessions(s);
    await s.auth.login(PARENT.email, PARENT.password);
    await s.family.unlinkChild(creds.student.id);
    expect(await s.family.children()).toEqual([]);
    expect(await codeOf(s.family.sessions(creds.student.id))).toBe('forbidden');
    expect(await s.db.get('consents', creds.student.id)).toBeUndefined();
    expect((await s.db.by('grants', 'studentId', creds.student.id)).map((g) => g.kind)).toEqual(['account']); // teacher's only
  });

  it('deletes a teacher account with the whole class, after re-checking the password', async () => {
    const s = await fresh();
    await withSessions(s);
    await s.auth.login(TEACHER.email, TEACHER.password);
    expect(await codeOf(s.account.deleteOwnAccount('wrong-password'))).toBe('wrong-password');
    await s.account.deleteOwnAccount(TEACHER.password);
    expect(s.auth.current()).toBeNull();
    for (const store of ['students', 'sessions', 'texts', 'grants', 'links', 'consents', 'baselines'] as const) {
      expect(await s.db.all(store), store).toEqual([]);
    }
    expect((await s.db.all('accounts')).map((a) => a.role)).toEqual(['parent']);
  });

  it('deletes a parent account without touching the class', async () => {
    const s = await fresh();
    const { creds } = await withSessions(s);
    await s.auth.login(PARENT.email, PARENT.password);
    await s.account.deleteOwnAccount(PARENT.password);
    expect((await s.db.all('accounts')).map((a) => a.role).sort()).toEqual(['student', 'teacher']);
    expect(await s.db.all('links')).toEqual([]);
    expect(await s.db.get('consents', creds.student.id)).toBeUndefined();
    expect(await s.db.by('sessions', 'studentId', creds.student.id)).toHaveLength(2);
  });

  it('wipes the whole device', async () => {
    const s = await fresh();
    await withSessions(s);
    s.db.close();
    await wipeDatabase(dbName);
    const empty = await Db.open(dbName);
    expect(await empty.all('accounts')).toEqual([]);
    expect(await empty.all('sessions')).toEqual([]);
  });
});

describe('empty database', () => {
  it('answers every listing with an empty result', async () => {
    const s = await fresh();
    expect(await s.auth.restore()).toBeNull();
    await s.auth.registerAdult('teacher', TEACHER);
    await s.auth.login(TEACHER.email, TEACHER.password);
    expect(await s.classroom.listStudents()).toEqual([]);
    expect(await s.classroom.listTexts()).toEqual([]);
    expect(overview([])).toMatchObject({ sessions: 0, lastAt: null, medianPace: null });
    expect(trend([])).toEqual([]);
    expect(sessionsToCsv([]).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('reports', () => {
  const parsed = parseText(TEXT.content);

  it('computes pace only from enough reading time', () => {
    expect(pace(summary())).toBeCloseTo((12 * 60_000) / 90_000);
    expect(pace(summary({ paragraphs: [{ index: 0, words: 7, timeMs: 3000 }] }))).toBeNull();
  });

  it('summarises and orders sessions over time', () => {
    const a = summary({ startedAt: 2000 });
    const b = summary({ startedAt: 1000, gaze: null, camera: 'declined', endReason: 'left', adaptations: [] });
    expect(overview([a, b])).toMatchObject({ sessions: 2, completed: 1, withCamera: 1, automaticAdaptations: 1, lastAt: 2000 });
    expect(trend([a, b]).map((p) => [p.startedAt, p.need])).toEqual([[1000, null], [2000, 0.31]]);
  });

  it('points at the sentence that took disproportionate effort', () => {
    const hard = effortfulPassages(summary(), parsed);
    expect(hard).toHaveLength(1);
    expect(hard[0]).toMatchObject({ sentence: 1, text: 'Un rat le réveilla.', regressionsIn: 3 });
    expect(hard[0]!.ratio).toBeGreaterThan(1.5);
    expect(effortfulPassages(summary({ gaze: null }), parsed)).toEqual([]);
  });

  it('lists the indicators that were present, strongest first', () => {
    expect(mainIndicators(summary()).map((i) => i.key)).toEqual(['prolongedFixations', 'frequentRegressions']);
    expect(mainIndicators(summary({ gaze: null }))).toEqual([]);
  });

  it('exports CSV that is safe to open in a spreadsheet', () => {
    const csv = sessionsToCsv([summary({ textTitle: '=HYPERLINK("http://x")', startedAt: 0 }), summary({ textTitle: 'الأسد, والفأر', startedAt: 1 })]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.split(',')).toHaveLength(15);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[2]).toContain('"الأسد, والفأر"');
    expect(csv.startsWith('﻿')).toBe(true);
  });
});
