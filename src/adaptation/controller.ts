/**
 * Adaptation policy: decides WHEN the support level changes.
 *
 * The inputs are noisy, and a page that keeps reshaping itself is worse than
 * one that never adapts. So the controller is deliberately slow and sticky:
 *  - assessments below a confidence floor are ignored entirely;
 *  - the need is smoothed before it is compared with thresholds;
 *  - going up needs the need to stay above a threshold for several
 *    consecutive assessments; going down needs it to stay below a LOWER
 *    threshold for much longer (hysteresis);
 *  - one level per change, a cooldown between changes, a cap per session;
 *  - a reversal shortly after a change freezes automation (anti-oscillation);
 *  - anything the student does by hand pauses automation and always wins.
 */
import type { Assessment, IndicatorKey, SupportDimension } from '@/difficulty/types';
import type { AdaptationEvent, AdaptationMode, Level, StudentSettings } from './types';

export const POLICY = {
  /** Assessments less trustworthy than this never move the level. */
  minConfidence: 0.5,
  /** Smoothing factor of the need (weight of the newest assessment). */
  smoothing: 0.4,
  /** Smoothed need required to be AT level 1, 2, 3. */
  upThresholds: [0.35, 0.55, 0.75] as readonly number[],
  /** Gap below the up-threshold before the level may drop again. */
  hysteresis: 0.15,
  /** Consecutive qualifying assessments before raising / lowering. */
  upStreak: 2,
  downStreak: 6,
  /** Minimum time after any change before the next raise / lower. */
  upCooldownMs: 25_000,
  downCooldownMs: 60_000,
  /** Automation stays out of the way this long after a manual adjustment. */
  manualHoldMs: 120_000,
  maxAutoChanges: 8,
  /** A direction reversal within this time of the previous change counts as oscillation. */
  oscillationWindowMs: 180_000,
  maxReversals: 2,
  /** Consecutive assessments needed before the dominant need is switched without a level change. */
  dominantStreak: 4,
};

export interface ControllerState {
  level: Level;
  dominant: SupportDimension | null;
  mode: AdaptationMode;
  /** Smoothed support need, for display in diagnostics. */
  smoothedNeed: number;
}

export interface Decision {
  event: AdaptationEvent;
  state: ControllerState;
}

export class AdaptationController {
  private level: Level;
  private dominant: SupportDimension | null = null;
  private smoothed = 0;
  private upCount = 0;
  private downCount = 0;
  private dominantCandidate: SupportDimension | null = null;
  private dominantCount = 0;
  private lastChangeAt = -Infinity;
  private lastDirection: 1 | -1 | 0 = 0;
  private reversals = 0;
  private autoChanges = 0;
  private holdUntil = -Infinity;
  private frozen = false;
  private log: AdaptationEvent[] = [];

  constructor(
    private settings: StudentSettings,
    /** False when no gaze observation is available: then only manual changes happen. */
    private automationAvailable: boolean,
    private readonly policy = POLICY,
  ) {
    this.level = settings.baseLevel;
  }

  stateAt(now: number): ControllerState {
    return { level: this.level, dominant: this.dominant, mode: this.mode(now), smoothedNeed: this.smoothed };
  }

  get events(): readonly AdaptationEvent[] {
    return this.log;
  }

  setAutomationAvailable(available: boolean): void {
    this.automationAvailable = available;
  }

  private mode(now: number): AdaptationMode {
    if (!this.automationAvailable || !this.settings.autoAdapt) return 'manual-only';
    if (this.frozen || now < this.holdUntil || this.autoChanges >= this.policy.maxAutoChanges) return 'held';
    return 'auto';
  }

  currentMode(now: number): AdaptationMode {
    return this.mode(now);
  }

  /** The student changed something by hand: automation steps back for a while. */
  noteManualAdjust(now: number): void {
    this.holdUntil = now + this.policy.manualHoldMs;
    this.upCount = 0;
    this.downCount = 0;
  }

  /** The student explicitly moved the support level ("more help" / "less help"). */
  setLevelManually(now: number, level: Level): Decision | null {
    const to = Math.max(0, Math.min(3, level)) as Level;
    if (to === this.level) return null;
    this.noteManualAdjust(now);
    return this.change(now, to, 'student', [], null);
  }

  /** "Keep it like this": stop automatic changes for the rest of the session (or resume). */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    this.upCount = 0;
    this.downCount = 0;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Feed one assessment. Returns a decision only when the presentation should change. */
  step(now: number, assessment: Assessment): Decision | null {
    if (assessment.status !== 'ok' || assessment.confidence < this.policy.minConfidence) {
      // No evidence is not evidence of ease: streaks pause, they do not advance.
      return null;
    }
    this.smoothed += this.policy.smoothing * (assessment.supportNeed - this.smoothed);
    if (this.mode(now) !== 'auto') return null;

    const { upThresholds, hysteresis } = this.policy;
    const floor = this.settings.baseLevel;
    const ceiling = Math.max(this.settings.maxLevel, floor) as Level;
    const sinceChange = now - this.lastChangeAt;

    const canGoUp = this.level < ceiling && this.smoothed >= upThresholds[this.level]!;
    const canGoDown = this.level > floor && this.smoothed < upThresholds[this.level - 1]! - hysteresis;
    this.upCount = canGoUp ? this.upCount + 1 : 0;
    this.downCount = canGoDown ? this.downCount + 1 : 0;

    const reasons = topIndicators(assessment);
    if (canGoUp && this.upCount >= this.policy.upStreak && sinceChange >= this.policy.upCooldownMs) {
      return this.autoChange(now, (this.level + 1) as Level, 1, assessment.dominant, reasons, assessment.confidence);
    }
    if (canGoDown && this.downCount >= this.policy.downStreak && sinceChange >= this.policy.downCooldownMs) {
      return this.autoChange(now, (this.level - 1) as Level, -1, this.dominant, reasons, assessment.confidence);
    }

    // Same level, but the kind of help needed has clearly changed.
    if (this.level > 0 && assessment.dominant && assessment.dominant !== this.dominant) {
      this.dominantCount = assessment.dominant === this.dominantCandidate ? this.dominantCount + 1 : 1;
      this.dominantCandidate = assessment.dominant;
      if (this.dominantCount >= this.policy.dominantStreak && sinceChange >= this.policy.upCooldownMs) {
        this.dominant = assessment.dominant;
        this.dominantCount = 0;
        this.autoChanges++;
        return this.change(now, this.level, 'auto', reasons, assessment.confidence);
      }
    } else {
      this.dominantCount = 0;
    }
    return null;
  }

  private autoChange(
    now: number,
    to: Level,
    direction: 1 | -1,
    dominant: SupportDimension | null,
    reasons: IndicatorKey[],
    confidence: number,
  ): Decision | null {
    if (this.lastDirection !== 0 && direction !== this.lastDirection && now - this.lastChangeAt <= this.policy.oscillationWindowMs) {
      this.reversals++;
      // Bouncing between two levels: settle on the more supportive one and stop.
      if (this.reversals >= this.policy.maxReversals) this.frozen = true;
    }
    this.lastDirection = direction;
    if (this.frozen && direction === -1) {
      // The freeze was triggered by this very reversal: stay at the higher level.
      this.upCount = 0;
      this.downCount = 0;
      return null;
    }
    this.autoChanges++;
    if (direction === 1) this.dominant = dominant ?? this.dominant;
    return this.change(now, to, 'auto', reasons, confidence);
  }

  private change(
    now: number,
    to: Level,
    trigger: AdaptationEvent['trigger'],
    reasons: IndicatorKey[],
    confidence: number | null,
  ): Decision {
    const event: AdaptationEvent = {
      atMs: now,
      trigger,
      fromLevel: this.level,
      toLevel: to,
      dominant: to === 0 ? null : this.dominant,
      reasons,
      confidence,
    };
    this.level = to;
    if (to === 0) this.dominant = null;
    this.lastChangeAt = now;
    this.upCount = 0;
    this.downCount = 0;
    this.log.push(event);
    return { event, state: this.stateAt(now) };
  }
}

function topIndicators(a: Extract<Assessment, { status: 'ok' }>): IndicatorKey[] {
  return [...a.indicators]
    .filter((i) => i.score >= 0.3)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((i) => i.key);
}
