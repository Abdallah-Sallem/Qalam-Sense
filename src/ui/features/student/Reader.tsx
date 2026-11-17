/**
 * The adaptive reader: renders the text, feeds the closed-loop pipeline, and
 * applies its decisions. All per-frame work goes through refs; React state
 * changes only when something the child can see changes.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRANSITION_MS, applyStyle, applyStyleAnchored } from '@/adaptation/applier';
import { styleFor } from '@/adaptation/presets';
import { NO_MANUAL, type FocusMode, type Level, type ManualAdjust, type ThemeName } from '@/adaptation/types';
import type { Baseline, SupportDimension } from '@/difficulty/types';
import type { CameraOutcome, EndReason, SessionSummary, Student, TextDoc } from '@/domain/types';
import { clamp } from '@/lib/math';
import { measureLayout } from '@/reading/layout';
import { directionOf, parseText, syllabifyFrench, type ParsedText, type Token } from '@/reading/text';
import { ReadingPipeline, type GazeSetup } from '@/session/pipeline';
import { Button, formatDuration } from '@/ui/components/ui';
import type { TrackingState } from '@/vision/types';
import { CalibrationView, type FrameHub } from './CalibrationView';

/** Reading time limit by age: young children tire quickly. */
export function maxDurationFor(age: number): number {
  if (age <= 7) return 10 * 60_000;
  if (age <= 10) return 15 * 60_000;
  if (age <= 13) return 20 * 60_000;
  return 30 * 60_000;
}

const THEME_CHOICES: ThemeName[] = ['paper', 'cream', 'sky', 'dusk'];
const FOCUS_CHOICES: FocusMode[] = ['none', 'paragraph', 'line-guide'];
const BREAK_HINT_EVERY_MS = 5 * 60_000;
const LOST_HINT_AFTER_MS = 4000;

interface Props {
  text: TextDoc;
  student: Student;
  hub: FrameHub | null;
  gaze: GazeSetup | null;
  camera: CameraOutcome;
  baseline: Baseline | null;
  /** Called exactly once when the session ends. */
  onFinish: (summary: SessionSummary, baseline: Baseline | null) => void;
  /** The camera stopped working during the session. */
  cameraLost: boolean;
}

const Word = memo(function Word({ token, paragraph, syllables }: { token: Token; paragraph: number; syllables: boolean }) {
  if (token.word < 0) return <> </>;
  const parts = syllables ? syllabifyFrench(token.text) : null;
  return (
    <span data-w={token.word} data-p={paragraph}>
      {parts && parts.length > 1
        ? parts.map((s, i) => (
            <span key={i} className={i % 2 ? 'syl-b' : 'syl-a'}>
              {s}
            </span>
          ))
        : token.text}
    </span>
  );
});

const Paragraph = memo(function Paragraph({
  tokens,
  index,
  active,
  syllables,
  onSelect,
}: {
  tokens: Token[];
  index: number;
  active: boolean;
  syllables: boolean;
  onSelect: (i: number) => void;
}) {
  return (
    <p data-para={index} className={active ? 'is-active' : ''} onClick={() => onSelect(index)}>
      {tokens.map((tok, i) => (
        <Word key={i} token={tok} paragraph={index} syllables={syllables} />
      ))}
    </p>
  );
});

export function Reader({ text, student, hub, gaze, camera, baseline, onFinish, cameraLost }: Props) {
  const { t } = useTranslation();
  const parsed: ParsedText = useMemo(() => parseText(text.content), [text.content]);
  const lang = text.language;
  const dir = directionOf(lang);
  const maxDuration = maxDurationFor(student.age);
  const syllables = student.settings.syllableColoring && lang === 'fr';

  const articleRef = useRef<HTMLElement>(null);
  const pipelineRef = useRef<ReadingPipeline | null>(null);
  const finished = useRef(false);
  const timing = useRef({ times: new Map<number, number>(), enteredAt: 0 });
  const startedAtWall = useRef(Date.now());
  const lastBreakHint = useRef(0);
  const cancelAnchor = useRef<() => void>(() => {});

  const [active, setActive] = useState(0);
  const [level, setLevel] = useState<Level>(student.settings.baseLevel);
  const [dominant, setDominant] = useState<SupportDimension | null>(null);
  const [manual, setManual] = useState<ManualAdjust>(NO_MANUAL);
  const [frozen, setFrozen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(maxDuration);
  const [tracking, setTracking] = useState<TrackingState | 'off'>(gaze ? 'degraded' : 'off');
  const [lostHint, setLostHint] = useState(false);
  const [panel, setPanel] = useState(false);
  const [toast, setToast] = useState<null | { kind: 'adapted'; previous: Level } | { kind: 'break' } | { kind: 'recalibrate' }>(null);
  const [recalibrating, setRecalibrating] = useState(false);
  const [gazeActive, setGazeActive] = useState(gaze !== null);

  const now = () => performance.now();
  const elapsed = () => pipelineRef.current?.elapsed(now()) ?? 0;

  // ── Layout measurement ────────────────────────────────────────────────
  const measure = useCallback(() => {
    const article = articleRef.current;
    if (article && pipelineRef.current) pipelineRef.current.setLayout(measureLayout(article, dir));
  }, [dir]);

  // ── Pipeline lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    const article = articleRef.current!;
    applyStyle(article, styleFor({ level: student.settings.baseLevel, dominant: null, lang, settings: student.settings, manual: NO_MANUAL }));
    const pipeline = new ReadingPipeline({
      parsed,
      lang,
      textDifficulty: text.difficulty,
      settings: student.settings,
      maxDurationMs: maxDuration,
      storedBaseline: baseline,
      layout: measureLayout(article, dir),
      gaze,
    });
    pipelineRef.current = pipeline;
    const t0 = now();
    pipeline.start(t0);
    pipeline.setActiveParagraph(0, 0, t0);
    timing.current = { times: new Map(), enteredAt: t0 };

    const offs = [
      pipeline.events.on('adaptation', ({ event, state }) => {
        setLevel(state.level);
        setDominant(state.dominant);
        if (event.trigger === 'auto' && event.toLevel > event.fromLevel) setToast({ kind: 'adapted', previous: event.fromLevel });
      }),
      pipeline.events.on('tracking', setTracking),
      pipeline.events.on('recalibrate', () => setToast((cur) => cur ?? { kind: 'recalibrate' })),
      pipeline.events.on('assessment', (a) => {
        if (a.status !== 'ok' || a.dimensions.fatigue < 0.6) return;
        const at = pipeline.elapsed(now());
        if (at - lastBreakHint.current < BREAK_HINT_EVERY_MS) return;
        lastBreakHint.current = at;
        setToast((cur) => cur ?? { kind: 'break' });
      }),
    ];
    const offFrames = hub?.on('frame', (frame) => {
      pipeline.onObservation(frame.t, frame.observation, { x: window.scrollX, y: window.scrollY });
    });

    // Fonts load after first paint and change every word's position.
    void document.fonts?.ready.then(measure);
    let resizeTimer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        measure();
        pipeline.setViewport({ width: window.innerWidth, height: window.innerHeight });
      }, 150);
    });
    observer.observe(article);

    return () => {
      observer.disconnect();
      window.clearTimeout(resizeTimer);
      offFrames?.();
      offs.forEach((off) => off());
      cancelAnchor.current();
      pipeline.dispose();
      pipelineRef.current = null;
    };
    // The session is created once per mount; props are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Apply presentation changes, keeping the reading position ─────────
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    const article = articleRef.current;
    if (!article) return;
    cancelAnchor.current();
    const anchor = article.querySelector(`[data-para="${active}"]`);
    cancelAnchor.current = applyStyleAnchored(article, styleFor({ level, dominant, lang, settings: student.settings, manual }), anchor);
    const timer = window.setTimeout(measure, TRANSITION_MS + 80);
    return () => window.clearTimeout(timer);
    // `active` is read, not a trigger: moving on must not re-apply the style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, dominant, manual]);

  // ── Finishing ─────────────────────────────────────────────────────────
  const closeParagraphTiming = useCallback((at: number) => {
    const tm = timing.current;
    tm.times.set(active, (tm.times.get(active) ?? 0) + Math.max(0, at - tm.enteredAt));
    tm.enteredAt = at;
  }, [active]);

  const finish = useCallback(
    (endReason: EndReason) => {
      const pipeline = pipelineRef.current;
      if (finished.current || !pipeline) return;
      finished.current = true;
      if (!paused) closeParagraphTiming(now());
      const paragraphs = [...timing.current.times.entries()]
        .filter(([, ms]) => ms >= 1000)
        .sort(([a], [b]) => a - b)
        .map(([index, timeMs]) => ({ index, words: parsed.paragraphs[index]!.filter((tok) => tok.word >= 0).length, timeMs: Math.round(timeMs) }));
      onFinish(
        {
          textId: text.id,
          textTitle: text.title,
          language: lang,
          startedAt: startedAtWall.current,
          durationMs: Math.round(pipeline.elapsed(now())),
          endReason,
          wordsTotal: parsed.wordCount,
          wordsRead: paragraphs.reduce((s, p) => s + p.words, 0),
          paragraphs,
          camera,
          finalLevel: pipeline.controller.stateAt(pipeline.elapsed(now())).level,
          adaptations: [...pipeline.controller.events],
          manual,
          gaze: pipeline.summary(),
        },
        pipeline.updatedBaseline(),
      );
    },
    [paused, closeParagraphTiming, parsed, onFinish, text, lang, camera, manual],
  );

  // ── Clock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      const left = maxDuration - elapsed();
      setRemaining(left);
      if (left <= 0) finish('time-limit');
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, maxDuration]);

  // ── Pause / resume ────────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (paused) return;
    closeParagraphTiming(now());
    pipelineRef.current?.pause(now());
    setPaused(true);
  }, [paused, closeParagraphTiming]);

  const resume = useCallback(() => {
    timing.current.enteredAt = now();
    pipelineRef.current?.resume(now());
    setPaused(false);
  }, []);

  useEffect(() => {
    const onVisibility = () => document.hidden && pause();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

  // ── Camera lost mid-session: carry on without it, say so calmly ──────
  useEffect(() => {
    if (!cameraLost) return;
    pipelineRef.current?.dropGaze();
    setGazeActive(false);
    setTracking('off');
  }, [cameraLost]);

  useEffect(() => {
    if (tracking !== 'lost') {
      setLostHint(false);
      return;
    }
    const timer = window.setTimeout(() => setLostHint(true), LOST_HINT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [tracking]);

  // ── Navigation between paragraphs ─────────────────────────────────────
  const goTo = useCallback(
    (index: number) => {
      const next = clamp(index, 0, parsed.paragraphs.length - 1);
      if (next === active) return;
      const at = now();
      closeParagraphTiming(at);
      setActive(next);
      pipelineRef.current?.setActiveParagraph(next, parsed.paragraphOf.indexOf(next), at);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      articleRef.current?.querySelector(`[data-para="${next}"]`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    },
    [active, parsed, closeParagraphTiming],
  );
  const isLast = active === parsed.paragraphs.length - 1;
  const next = useCallback(() => (isLast ? finish('completed') : goTo(active + 1)), [isLast, finish, goTo, active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || recalibrating || (e.target as HTMLElement).closest('button, input, select, [role="dialog"]')) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goTo(active - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, goTo, active, paused, recalibrating]);

  // ── Manual controls: the student always wins over automation ─────────
  const adjust = (patch: Partial<ManualAdjust>) => {
    pipelineRef.current?.controller.noteManualAdjust(elapsed());
    setManual((m) => ({ ...m, ...patch }));
  };
  const changeLevel = (to: number) => {
    const decision = pipelineRef.current?.controller.setLevelManually(elapsed(), clamp(to, 0, 3) as Level);
    if (decision) {
      setLevel(decision.state.level);
      setDominant(decision.state.dominant);
    }
  };
  const toggleFrozen = () => {
    pipelineRef.current?.controller.setFrozen(!frozen);
    setFrozen(!frozen);
  };

  const automatic = gazeActive && student.settings.autoAdapt;
  const lowTime = remaining < 2 * 60_000;

  return (
    <div className="reader" data-theme={manual.theme ?? undefined}>
      <header className="reader-bar">
        <Button variant="ghost" onClick={() => finish('left')}>
          {t('reader.stop')}
        </Button>
        <div className="reader-bar-mid">
          <span className="reader-title" lang={lang} dir={dir}>
            {text.title}
          </span>
          <progress className="reader-progress" max={parsed.paragraphs.length} value={active + 1} aria-label={t('reader.progress', { current: active + 1, total: parsed.paragraphs.length })} />
        </div>
        <div className="reader-bar-end">
          {gazeActive && (
            <span className={`pill pill-${tracking}`} title={t(`reader.tracking.${tracking}`)}>
              <span className="pill-dot" aria-hidden="true" />
              {t('reader.helper')}
            </span>
          )}
          <span className={`reader-clock ${lowTime ? 'is-low' : ''}`} aria-label={t('reader.timeLeft')}>
            {formatDuration(remaining)}
          </span>
          <Button variant="ghost" onClick={pause} aria-label={t('reader.pause')}>
            ⏸
          </Button>
          <Button variant="secondary" onClick={() => setPanel((p) => !p)} aria-expanded={panel} aria-controls="reader-panel">
            {t('reader.display')}
          </Button>
        </div>
      </header>

      {panel && (
        <section id="reader-panel" className="reader-panel" aria-label={t('reader.display')}>
          <div className="panel-row">
            <span>{t('reader.size')}</span>
            <Button onClick={() => adjust({ sizeSteps: Math.max(-1, manual.sizeSteps - 1) })} aria-label={t('reader.smaller')} disabled={manual.sizeSteps <= -1}>
              A−
            </Button>
            <Button onClick={() => adjust({ sizeSteps: Math.min(3, manual.sizeSteps + 1) })} aria-label={t('reader.bigger')} disabled={manual.sizeSteps >= 3}>
              A+
            </Button>
          </div>
          <div className="panel-row">
            <span>{t('reader.spacing')}</span>
            <Button onClick={() => adjust({ spacingSteps: Math.max(0, manual.spacingSteps - 1) })} aria-label={t('reader.lessSpace')} disabled={manual.spacingSteps <= 0}>
              −
            </Button>
            <Button onClick={() => adjust({ spacingSteps: Math.min(2, manual.spacingSteps + 1) })} aria-label={t('reader.moreSpace')} disabled={manual.spacingSteps >= 2}>
              +
            </Button>
          </div>
          <div className="panel-row" role="group" aria-label={t('reader.colours')}>
            <span>{t('reader.colours')}</span>
            {THEME_CHOICES.map((theme) => (
              <button
                key={theme}
                type="button"
                className={`swatch swatch-${theme}`}
                aria-pressed={manual.theme === theme}
                aria-label={t(`reader.theme.${theme}`)}
                onClick={() => adjust({ theme: manual.theme === theme ? null : theme })}
              />
            ))}
          </div>
          <div className="panel-row" role="group" aria-label={t('reader.focus')}>
            <span>{t('reader.focus')}</span>
            {FOCUS_CHOICES.map((f) => (
              <Button key={f} aria-pressed={manual.focus === f} onClick={() => adjust({ focus: manual.focus === f ? null : f })}>
                {t(`reader.focusMode.${f}`)}
              </Button>
            ))}
          </div>
          <div className="panel-row">
            <span>{t('reader.help')}</span>
            <Button onClick={() => changeLevel(level - 1)} disabled={level <= 0}>
              {t('reader.lessHelp')}
            </Button>
            <span className="level-dots" aria-label={t('reader.levelOf', { level })}>
              {[1, 2, 3].map((i) => (
                <span key={i} className={i <= level ? 'on' : ''} />
              ))}
            </span>
            <Button onClick={() => changeLevel(level + 1)} disabled={level >= 3}>
              {t('reader.moreHelp')}
            </Button>
          </div>
          {automatic && (
            <label className="panel-row panel-check">
              <input type="checkbox" checked={frozen} onChange={toggleFrozen} />
              {t('reader.keep')}
            </label>
          )}
          <p className="muted">{t(automatic ? 'reader.autoOn' : 'reader.autoOff')}</p>
        </section>
      )}

      {lostHint && !paused && (
        <p className="reader-hint" role="status">
          {t('reader.cannotSee')}
        </p>
      )}
      {cameraLost && (
        <p className="reader-hint" role="status">
          {t('reader.cameraStopped')}
        </p>
      )}

      <article ref={articleRef} className="reader-text" data-reader data-active-paragraph={active} lang={lang} dir={dir}>
        <h1>{text.title}</h1>
        {parsed.paragraphs.map((tokens, i) => (
          <Paragraph key={i} tokens={tokens} index={i} active={i === active} syllables={syllables} onSelect={goTo} />
        ))}
      </article>

      <nav className="reader-nav" aria-label={t('reader.navigation')}>
        <Button onClick={() => goTo(active - 1)} disabled={active === 0}>
          {t('reader.previous')}
        </Button>
        <span className="muted" aria-live="polite">
          {t('reader.progress', { current: active + 1, total: parsed.paragraphs.length })}
        </span>
        <Button variant="primary" onClick={next} data-next={isLast ? 'finish' : 'next'}>
          {t(isLast ? 'reader.finish' : 'reader.next')}
        </Button>
      </nav>

      {toast && !paused && (
        <div className="toast" role="status">
          {toast.kind === 'adapted' && (
            <>
              <span>{t('reader.adapted')}</span>
              <Button variant="primary" onClick={() => setToast(null)}>
                {t('reader.adaptedOk')}
              </Button>
              <Button
                onClick={() => {
                  changeLevel(toast.previous);
                  setToast(null);
                }}
              >
                {t('reader.adaptedUndo')}
              </Button>
            </>
          )}
          {toast.kind === 'break' && (
            <>
              <span>{t('reader.breakOffer')}</span>
              <Button
                variant="primary"
                onClick={() => {
                  setToast(null);
                  pause();
                }}
              >
                {t('reader.breakYes')}
              </Button>
              <Button onClick={() => setToast(null)}>{t('reader.breakNo')}</Button>
            </>
          )}
          {toast.kind === 'recalibrate' && (
            <>
              <span>{t('reader.recalibrateOffer')}</span>
              <Button
                variant="primary"
                onClick={() => {
                  setToast(null);
                  pause();
                  setRecalibrating(true);
                }}
              >
                {t('reader.recalibrateYes')}
              </Button>
              <Button
                onClick={() => {
                  pipelineRef.current?.dismissRecalibration();
                  setToast(null);
                }}
              >
                {t('reader.recalibrateNo')}
              </Button>
            </>
          )}
        </div>
      )}

      {paused && !recalibrating && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={t('reader.paused')}>
          <div className="overlay-card">
            <h2>{t('reader.paused')}</h2>
            <p>{t('reader.pausedBody')}</p>
            <Button variant="primary" onClick={resume} autoFocus>
              {t('reader.resume')}
            </Button>
          </div>
        </div>
      )}

      {recalibrating && hub && (
        <CalibrationView
          hub={hub}
          onCancel={() => {
            pipelineRef.current?.dismissRecalibration();
            setRecalibrating(false);
            resume();
          }}
          onDone={(result) => {
            if (result.ok) pipelineRef.current?.recalibrate({ model: result.model, quality: result.quality, viewport: result.viewport });
            else pipelineRef.current?.dismissRecalibration();
            setRecalibrating(false);
            resume();
            window.setTimeout(measure, 50);
          }}
        />
      )}
    </div>
  );
}
