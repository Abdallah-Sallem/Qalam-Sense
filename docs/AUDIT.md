# Engineering audit of the original code

Audit date: 2026-11-17. Subject: the prototype as it stood before the rebuild
(uncommitted working tree on top of commit `fea3f57`, about 7,500 lines of
TypeScript/React). A full copy is archived in
`.snapshots/pre-transformation-2026-11-17.tar.gz` (not tracked by git).

The prototype compiled, but most of its central features did not work. The
findings below drove the decision to rebuild the core and keep the product
idea, roles and screen flow.

Severity scale: **Critical** (the feature does not work, or children's data
is at risk), **High** (wrong or misleading results), **Medium** (reliability,
maintainability), **Low** (polish).

## Eye tracking

| # | Severity | Finding |
|---|---|---|
| E1 | Critical | WebGazer was started without any calibration step. WebGazer learns its mapping only from clicks; with none, its output is effectively random, which is the "cursor moving randomly" seen in use. |
| E2 | Critical | WebGazer was loaded from a CDN (`cdn.jsdelivr.net`) at run time, contradicting the claim that nothing leaves the device and failing offline. |
| E3 | High | No confidence, no validity flag: every coordinate WebGazer produced was treated as an observation, including blinks, turned heads and off-screen estimates. |
| E4 | High | `GazeAnonymizer` counted "regressions" as any leftward movement over 30 px, which is wrong for Arabic (read right to left) and counts ordinary noise. |
| E5 | High | Blink rate was a constant 15/min: `registerBlink()` was never called by anything. |
| E6 | High | "Fixation duration" was the number of frames whose position changed by less than 20 px, multiplied by 33 ms, across a 1-second window. That is not a fixation measure. |
| E7 | Medium | No tracking-loss detection, recovery, recalibration or face/lighting checks. |
| E8 | Medium | No reading-aware layer: gaze was never related to lines or words of the text. |

## Difficulty detection

| # | Severity | Finding |
|---|---|---|
| D1 | High | Signals were labelled `dyslexia-visual`, and profiles carried `neurodivergenceTypes`, i.e. the system attached neurological labels to children from noisy webcam data. |
| D2 | High | Fixed population thresholds (e.g. "fixation > 400 ms means difficulty") applied to webcam measurements, which are much coarser than laboratory ones. No personal baseline. |
| D3 | High | No notion of "insufficient data": with poor tracking the engine still emitted signals. |
| D4 | Medium | `CognitiveModel`, `BiasChecker`, `ProfileLearner` were never used (dead code). The "Phase 2 ONNX model" did not exist. |
| D5 | Medium | The difficulty signal's language was hardcoded to `'fr'`. |

## Adaptation

| # | Severity | Finding |
|---|---|---|
| A1 | High | Every detection above a threshold re-styled the page immediately: no smoothing, hysteresis, cooldown or confidence gating, so noise would make the page flicker. |
| A2 | Medium | `TransitionEngine` applied all variables, then re-applied some of them 100 ms and 200 ms later: duplicated work with no effect. |
| A3 | Medium | Reading position was not preserved when the text reflowed. |
| A4 | Medium | Letter spacing was applied to Arabic, which breaks the joins of cursive script. |
| A5 | Medium | `useBilingual` created a new `BilingualHandler` on every render. |

## Data, privacy and security

| # | Severity | Finding |
|---|---|---|
| S1 | Critical | The local database key was derived from a hardcoded password (`'qalam-sense-local-key'`) with a **new random salt on every page load**, so data written in one visit could never be decrypted in the next. The key also protected nothing, being in the source. |
| S2 | Critical | Reading sessions were created but never read back correctly (see S1); the parent dashboard's statistics could not work. |
| S3 | Critical | The parent "delete data" button showed `alert('Suppression à implémenter')`. No deletion existed. |
| S4 | High | Passwords and PINs hashed with a single round of SHA-256: trivial to brute-force, especially 4-digit PINs. No lockout after failed attempts. |
| S5 | High | A parent could link any child by typing the child's ID. Nothing proved the relationship. |
| S6 | High | Student PINs were stored **in clear** in `localStorage` (`qs_created_students`) so the teacher view could display them. |
| S7 | High | Role checks (`SessionGuard`) existed but were not used by any data access: any signed-in user could read any record. |
| S8 | Medium | Consent was stored per student but not tied to a policy version, and withdrawing it did not affect stored data. |
| S9 | Medium | `SyncService` contained a `fetch` to an undefined server URL. |
| S10 | Low | `MAX_SESSION_DURATION_MS` left at 2 minutes "for testing". |

## Engineering

| # | Severity | Finding |
|---|---|---|
| G1 | High | A global `EventBus` singleton: subscriptions were never removed on session end, so handlers accumulated across sessions (memory leak, duplicated reactions). |
| G2 | Medium | No tests at all. Empty `docs/` and a one-line README. |
| G3 | Medium | React and react-dom were in `devDependencies` with mismatched `@types` versions. |
| G4 | Medium | i18n was configured but only 7 strings were translated; the interface was hardcoded in French. |
| G5 | Low | Inline styles everywhere; no shared component library; very large components (600-line dashboards). |

## Decisions taken

- **Rebuild the vision pipeline** on MediaPipe Face Landmarker with explicit calibration, confidence and loss handling (see [EYE_TRACKING.md](EYE_TRACKING.md)).
- **Replace labels with support needs** and personal baselines (see [ADAPTATION_ENGINE.md](ADAPTATION_ENGINE.md)).
- **Replace the storage and security layer** with real key management, role checks in every service, and real deletion (see [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md)).
- **Replace the global bus** with per-object typed emitters disposed with their owner.
- **Keep** the product idea, the three roles, the screen flow, and the bilingual Arabic/French scope.
