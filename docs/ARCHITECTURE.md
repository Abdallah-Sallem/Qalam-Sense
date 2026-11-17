# Architecture

Qalam-Sense is a single-page web application with **no backend**. Everything,
including the computer vision, runs in the browser; all data lives in the
browser's IndexedDB. This was a deliberate choice: the data concerns children,
the target environment is ordinary school laptops, and a server would add
cost, operations and a new place for data to leak without improving any
feature the product needs today.

## Layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Presentation  src/ui/, src/app/                                      │
│   React screens, i18n (fr/ar), styles. No business rules.            │
├──────────────────────────────────────────────────────────────────────┤
│ Application   src/services/, src/auth/, src/session/                 │
│   Use cases with role checks: classroom, family, student, account.   │
│   ReadingPipeline wires the closed loop for one reading session.     │
├───────────────┬───────────────────┬──────────────────┬───────────────┤
│ Vision        │ Reading analysis  │ Difficulty       │ Adaptation    │
│ src/vision/   │ src/reading/      │ src/difficulty/  │ src/adaptation│
│ camera →      │ text model,       │ indicators,      │ policy,       │
│ landmarks →   │ layout, fixations,│ personal         │ presets,      │
│ geometry →    │ line/word mapping,│ baseline,        │ DOM applier   │
│ gaze + conf.  │ window features   │ assessment       │               │
├───────────────┴───────────────────┴──────────────────┴───────────────┤
│ Persistence & security  src/data/, src/security/                     │
│   IndexedDB wrapper, Web Crypto key scheme, input validation.        │
└──────────────────────────────────────────────────────────────────────┘
```

Dependencies point downwards only. The four domain columns are pure
TypeScript with no DOM or React (except `vision/cameraSource.ts`,
`reading/layout.ts#measureLayout` and `adaptation/applier.ts`, the thin
adapters to the browser). That is what makes them unit-testable in Node.

## The closed loop

```
 webcam frame (30 fps)
     │  vision/cameraSource.ts   MediaPipe Face Landmarker, 478 points
     ▼
 FaceObservation                 vision/faceGeometry.ts
     │  iris offset in eye widths, head pose, blink, face position
     ▼
 GazeSample {x, y, valid, confidence}      vision/gazeTracker.ts
     │  calibrated regression + One Euro filter + validity gates
     ▼
 Fixation                        reading/fixations.ts (I-DT)
     ▼
 ReadingFixation {line, word, kind}        reading/readingMapper.ts
     │  Viterbi filter over lines, RTL/LTR aware
     ▼
 WindowFeatures (30 s)           reading/readingAnalyzer.ts
     ▼
 Assessment {indicators, supportNeed, confidence} or "insufficient data"
     │                           difficulty/engine.ts
     ▼
 Decision {level, dominant need} adaptation/controller.ts
     │  confidence gate, hysteresis, cooldowns, anti-oscillation
     ▼
 ReadingStyle → CSS variables    adaptation/presets.ts + applier.ts
     │  transition, reading position kept in place
     ▼
 the child reads the re-styled text … and the loop continues
```

`session/pipeline.ts` (`ReadingPipeline`) owns one instance of each stage for
the duration of a reading session and exposes typed events (`fixation`,
`assessment`, `adaptation`, `tracking`, `recalibrate`). `dispose()` removes
every subscription.

## Event communication

There is no global event bus. Each object that produces events owns a small
typed `Emitter` (`lib/emitter.ts`). Payload types are checked by the
compiler, a throwing listener cannot break the frame loop, and subscriptions
die with their owner. The old global singleton leaked handlers across
sessions (audit G1).

## Performance design

- Inference runs on the GPU delegate when available (CPU fallback), driven by
  `requestVideoFrameCallback` so a camera frame is never processed twice.
  When inference averages more than 28 ms, every other frame is skipped.
- Per-frame work never touches React state. The UI re-renders only when
  something visible changes (calibration target, tracking state, decision).
- Text layout is measured once per reflow (fonts loaded, resize, style
  change), not per frame.
- The MediaPipe bundle is code-split and loaded only when the camera is used.

Web Workers were considered for inference. MediaPipe's GPU delegate needs a
WebGL context, which is reliably available on the main thread but not in
workers on all target browsers; measured inference on the GPU leaves the main
thread responsive (see [TESTING.md](TESTING.md#performance)). Moving
inference to an OffscreenCanvas worker is listed as a future improvement.

## Persistence

`data/db.ts` wraps IndexedDB with one object store per entity: accounts,
students, key grants, parent links, texts, consents, sessions, baselines,
audit log and the current auth session. Multi-record operations (creating a
student, deleting a child's data) run in a single transaction, so they either
complete fully or not at all.

## Routing and state

Hash routing (`app/router.ts`) keeps the app deployable as static files on any
host or sub-path, and a refresh returns to the same screen. Global state is
limited to the services object and the current session (`AppContext`); each
screen loads its own data through the services.

## Directory map

| Path | Contents |
|---|---|
| `src/vision/` | Camera access, MediaPipe source, face geometry, frame quality, gaze model, calibration, tracker |
| `src/reading/` | Text parsing and syllables, layout model, fixation detection, line/word mapper, window features |
| `src/difficulty/` | Indicator rules, support dimensions, engine with personal baseline |
| `src/adaptation/` | Adaptation policy, typography presets per script, DOM applier |
| `src/session/` | `ReadingPipeline`, the closed loop for one session |
| `src/services/` | Teacher, parent, student and account use cases; reports and CSV export |
| `src/auth/` | Accounts, sign-in, lockout, password change |
| `src/security/` | Web Crypto scheme, input validation |
| `src/data/` | IndexedDB wrapper |
| `src/ui/` | Screens, components, i18n, styles |
| `src/testing/` | Test instruments: synthetic eye, scripted readers, harness |
| `tests/` | Unit and integration tests (Vitest), benchmark |
| `e2e/` | End-to-end tests (Playwright) |
