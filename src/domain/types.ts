/** Persistent domain model. Everything here is stored in the browser's IndexedDB. */
import type { AdaptationEvent, Level, ManualAdjust, StudentSettings } from '@/adaptation/types';
import type { Baseline, TextDifficulty } from '@/difficulty/types';
import type { Lang } from '@/reading/text';
import type { SealedBox, WrappedKey } from '@/security/crypto';
import type { GazeSummary } from '@/session/pipeline';

export type Role = 'teacher' | 'parent' | 'student';

export interface Account {
  id: string;
  role: Role;
  /** Unique sign-in name: lower-cased e-mail for adults, generated login for students. */
  loginId: string;
  displayName: string;
  /** PBKDF2 parameters and the derived verifier. The password itself is never stored. */
  salt: string;
  iterations: number;
  verifier: string;
  failedAttempts: number;
  /** Epoch ms until which sign-in is refused after repeated failures. */
  lockedUntil: number;
  createdAt: number;
}

export interface Student {
  /** Same id as the student's account. */
  id: string;
  teacherId: string;
  displayName: string;
  age: number;
  language: Lang;
  settings: StudentSettings;
  /** Public half of the student's data key: anyone may encrypt session records to it. */
  publicKey: JsonWebKey;
  createdAt: number;
}

/**
 * The private half of a student's data key, encrypted for one holder.
 * `account` grants are wrapped with the holder's password-derived key;
 * a `link-code` grant is wrapped with a one-time code handed to a parent.
 */
export interface KeyGrant {
  id: string;
  studentId: string;
  holderId: string;
  kind: 'account' | 'link-code';
  wrapped: WrappedKey;
  /** PBKDF2 salt and cost, for link-code grants only. */
  salt?: string;
  iterations?: number;
}

export interface ParentLink {
  id: string;
  parentId: string;
  studentId: string;
  linkedAt: number;
}

export interface TextDoc {
  id: string;
  teacherId: string;
  title: string;
  content: string;
  language: Lang;
  difficulty: TextDifficulty;
  assignedTo: string[];
  createdAt: number;
}

export const CONSENT_POLICY_VERSION = '2026-11';

export interface Consent {
  studentId: string;
  parentId: string;
  /** Permission to observe reading through the webcam, on this device only. */
  camera: boolean;
  grantedAt: number;
  policyVersion: string;
}

export type CameraOutcome =
  | 'used'
  | 'no-consent'
  | 'declined'
  | 'unavailable'
  | 'permission-denied'
  | 'calibration-failed'
  | 'model-missing';

export type EndReason = 'completed' | 'time-limit' | 'left';

/** What is kept about one reading session. Encrypted at rest (see SessionRecord). */
export interface SessionSummary {
  textId: string;
  textTitle: string;
  language: Lang;
  startedAt: number;
  durationMs: number;
  endReason: EndReason;
  wordsTotal: number;
  /** Words in the paragraphs the student went through. */
  wordsRead: number;
  /** Time spent on each paragraph visited, in order of first visit. */
  paragraphs: { index: number; words: number; timeMs: number }[];
  camera: CameraOutcome;
  finalLevel: Level;
  adaptations: AdaptationEvent[];
  manual: ManualAdjust;
  /** Null when the camera was not used. */
  gaze: GazeSummary | null;
}

export interface SessionRecord {
  id: string;
  studentId: string;
  textId: string;
  startedAt: number;
  /** SessionSummary encrypted to the student's public key. */
  sealed: SealedBox;
}

export interface BaselineRecord {
  id: string;
  studentId: string;
  language: Lang;
  baseline: Baseline;
  updatedAt: number;
}

export type AuditAction =
  | 'login'
  | 'login-failed'
  | 'logout'
  | 'student-created'
  | 'student-deleted'
  | 'pin-reset'
  | 'link-code-issued'
  | 'child-linked'
  | 'child-unlinked'
  | 'consent-granted'
  | 'consent-revoked'
  | 'sessions-viewed'
  | 'sessions-exported'
  | 'sessions-deleted'
  | 'password-changed';

export interface AuditEntry {
  id: string;
  at: number;
  actorId: string;
  actorRole: Role | 'anonymous';
  action: AuditAction;
  /** Student concerned, when there is one. */
  studentId?: string;
}

/** The signed-in user. `kek` is present for adults and never leaves the browser's key store. */
export interface AuthSession {
  accountId: string;
  role: Role;
  displayName: string;
  expiresAt: number;
  kek?: CryptoKey;
}
