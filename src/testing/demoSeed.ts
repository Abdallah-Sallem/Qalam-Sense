/**
 * TEST INSTRUMENT — seeds a fictional classroom for demo recordings.
 *
 * Only reachable in builds made with VITE_ENABLE_TEST_HOOKS=true, through
 * `?demo=<scene>` in the URL. It wipes this browser's Qalam-Sense data, then
 * creates a fictional teacher, parent and student ("Amine", 9) with fixed demo
 * credentials, and signs in the role the scene starts from.
 *
 * Amine's reading baseline and past session are NOT hand-written: they are
 * produced by running the real ReadingPipeline on a simulated reader (the same
 * harness as the integration tests), so every number shown is genuine output
 * of the engine for that simulated reader.
 */
import { DEFAULT_SETTINGS } from '@/adaptation/types';
import type { Baseline } from '@/difficulty/types';
import { Db, wipeDatabase } from '@/data/db';
import type { SessionSummary } from '@/domain/types';
import { createRng } from '@/lib/random';
import { parseText } from '@/reading/text';
import { deriveSecrets, newSalt } from '@/security/crypto';
import { createServices, type Services } from '@/services';
import { ReadingPipeline } from '@/session/pipeline';
import { FRAME_MS, gridLayout, runSyntheticCalibration } from './harness';
import { EFFORTFUL_READER, STEADY_READER, planReading, targetAt, type ReaderProfile } from './readingSimulator';
import { observeGaze } from './syntheticEye';
import { syntheticControls } from './syntheticSource';

export const DEMO_ACCOUNTS = {
  teacher: { email: 'nadia.trabelsi@ecole-demo.tn', password: 'demo-lecture-2026', displayName: 'Mme Trabelsi' },
  parent: { email: 'parent.amine@demo.tn', password: 'demo-maison-2026', displayName: 'M. Ben Salah' },
  studentPin: '2468',
};

export const DEMO_TEXT = {
  title: 'Le renard et la tortue',
  difficulty: 'moyen' as const,
  content: [
    'Le petit renard se réveille tôt dans la forêt. Le soleil traverse les grands arbres et la rosée brille sur les feuilles. Il sort de son terrier et regarde autour de lui.',
    'Au bord du ruisseau, il rencontre une vieille tortue. Elle avance lentement, mais elle connaît tous les chemins de la forêt. Le renard lui demande où trouver des mûres sucrées.',
    'La tortue sourit et lui montre une colline au loin. Le renard court à travers les fougères, saute par-dessus les pierres et arrive enfin devant un buisson couvert de fruits.',
    'Il mange quelques mûres puis pense à son amie. Il remplit une grande feuille de fruits et retourne vers le ruisseau pour partager son trésor avec la tortue.',
    'Le soir, les deux amis s’assoient au bord de l’eau. La tortue raconte des histoires anciennes et le renard écoute en silence, pendant que les étoiles apparaissent une à une.',
  ].join('\n\n'),
};

export type DemoScene = 'teacher' | 'student' | 'parent' | 'report';

const VIEWPORT = { width: 1366, height: 768 };
/** Iris noise of the simulated eye, chosen to give webcam-like calibration errors (tens of pixels). */
const EYE = { noise: 0.02 };

/** Runs the real pipeline over the text with a simulated reader. */
function simulate(phases: { profile: ReaderProfile; seconds: number }[], seed: number, storedBaseline: Baseline | null) {
  const parsed = parseText(DEMO_TEXT.content);
  const layout = gridLayout(parsed, { direction: 'ltr', wordsPerLine: 9 });
  const { result } = runSyntheticCalibration(VIEWPORT, createRng(seed), EYE);
  if (!result.ok) throw new Error('demo seed: simulated calibration failed');
  const pipeline = new ReadingPipeline({
    parsed,
    lang: 'fr',
    textDifficulty: DEMO_TEXT.difficulty,
    settings: DEFAULT_SETTINGS,
    maxDurationMs: 15 * 60_000,
    storedBaseline,
    layout,
    gaze: { model: result.model, quality: result.quality, viewport: VIEWPORT },
  });
  const rng = createRng(seed + 1);
  const times = new Map<number, number>();
  let t = 0;
  let word = 0;
  let paragraph = -1;
  pipeline.start(0);
  for (const phase of phases) {
    const until = t + phase.seconds * 1000;
    const plan = planReading(layout, phase.profile, rng, { from: word, to: parsed.wordCount - 1 }, t, until);
    for (; t < until; t += FRAME_MS) {
      const g = targetAt(plan, t);
      if (!g) continue;
      word = g.word;
      const p = parsed.paragraphOf[g.word]!;
      times.set(p, (times.get(p) ?? 0) + FRAME_MS);
      if (p !== paragraph) {
        paragraph = p;
        pipeline.setActiveParagraph(p, parsed.paragraphOf.indexOf(p), t);
      }
      const scrollY = Math.max(0, layout.lines[layout.words[g.word]!.line]!.centerY - VIEWPORT.height / 2);
      pipeline.onObservation(t, observeGaze({ x: g.point.x, y: g.point.y - scrollY }, VIEWPORT, t, rng, EYE), { x: 0, y: scrollY });
    }
  }
  return { pipeline, parsed, times, endT: t };
}

async function setPin(db: Db, studentId: string, pin: string, iterations: number): Promise<void> {
  const account = await db.get('accounts', studentId);
  if (!account) throw new Error('demo seed: student account missing');
  const salt = newSalt();
  const { verifier } = await deriveSecrets(pin, salt, iterations);
  await db.put('accounts', { ...account, salt, verifier, iterations });
}

async function seed(s: Services, now: number): Promise<{ studentLogin: string }> {
  const iterations = s.auth.config.iterations;
  // Teacher, text, student.
  await s.auth.registerAdult('teacher', DEMO_ACCOUNTS.teacher);
  await s.auth.login(DEMO_ACCOUNTS.teacher.email, DEMO_ACCOUNTS.teacher.password);
  const text = await s.classroom.saveText(DEMO_TEXT);
  const amine = await s.classroom.createStudent({ displayName: 'Amine', age: 9, language: 'fr' });
  await setPin(s.db, amine.student.id, DEMO_ACCOUNTS.studentPin, iterations);
  await s.classroom.assignText(text.id, [amine.student.id]);
  await s.auth.logout();

  // Parent links Amine and allows the camera.
  await s.auth.registerAdult('parent', DEMO_ACCOUNTS.parent);
  await s.auth.login(DEMO_ACCOUNTS.parent.email, DEMO_ACCOUNTS.parent.password);
  await s.family.linkChild(amine.loginId, amine.linkCode);
  await s.family.setCameraConsent(amine.student.id, true);
  await s.auth.logout();

  // Amine's history, produced by the real pipeline on simulated readers:
  // a calm earlier session sets his baseline; yesterday's session got harder halfway.
  await s.auth.login(amine.loginId, DEMO_ACCOUNTS.studentPin);
  const calm = simulate([{ profile: STEADY_READER, seconds: 45 }], 11, null);
  const baseline = calm.pipeline.updatedBaseline();
  if (baseline) await s.student.saveBaseline('fr', baseline);

  const hard = simulate(
    [
      { profile: STEADY_READER, seconds: 22 },
      { profile: EFFORTFUL_READER, seconds: 130 },
    ],
    23,
    baseline,
  );
  const elapsed = hard.pipeline.elapsed(hard.endT);
  const paragraphs = [...hard.times.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, timeMs]) => ({ index, words: hard.parsed.paragraphs[index]!.filter((tok) => tok.word >= 0).length, timeMs }));
  const summary: SessionSummary = {
    textId: text.id,
    textTitle: text.title,
    language: 'fr',
    startedAt: now - 26 * 3600_000,
    durationMs: Math.round(elapsed),
    endReason: 'completed',
    wordsTotal: hard.parsed.wordCount,
    wordsRead: paragraphs.reduce((a, p) => a + p.words, 0),
    paragraphs,
    camera: 'used',
    finalLevel: hard.pipeline.controller.stateAt(elapsed).level,
    adaptations: [...hard.pipeline.controller.events],
    manual: { sizeSteps: 0, spacingSteps: 0, theme: null, focus: null },
    gaze: hard.pipeline.summary(),
  };
  await s.student.saveSession(summary);
  await s.auth.logout();
  return { studentLogin: amine.loginId };
}

/** Called once at start-up in test-hook builds. Returns after the seed is in place. */
export async function runDemoSeed(params: URLSearchParams): Promise<void> {
  const scene = params.get('demo') as DemoScene | null;
  if (!scene) return;
  await wipeDatabase();
  const db = await Db.open();
  const s = createServices(db, { iterations: 1000 });
  const { studentLogin } = await seed(s, Date.now());

  if (scene === 'teacher' || scene === 'report') await s.auth.login(DEMO_ACCOUNTS.teacher.email, DEMO_ACCOUNTS.teacher.password);
  if (scene === 'parent') await s.auth.login(DEMO_ACCOUNTS.parent.email, DEMO_ACCOUNTS.parent.password);
  if (scene === 'student') {
    await s.auth.login(studentLogin, DEMO_ACCOUNTS.studentPin);
    sessionStorage.setItem('qalam:test-source', 'synthetic');
    const profile = params.get('profile');
    if (profile === 'steady' || profile === 'effortful') syntheticControls.profile = profile;
    syntheticControls.autoAdvance = params.get('advance') !== '0';
  }
  if (params.get('banner') === '0') sessionStorage.setItem('qalam:hide-test-banner', '1');
  db.close();
  // Drop the query so a reload does not wipe the data again.
  history.replaceState(null, '', `${location.pathname}#/`);
}
