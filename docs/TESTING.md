# Testing

| Command | What it runs |
|---|---|
| `npm test` | Unit and integration tests (Vitest, Node) |
| `npm run test:coverage` | Same, with a coverage report in `coverage/` |
| `npm run test:perf` | Per-frame performance budgets |
| `npm run test:e2e` | End-to-end tests in Chromium (Playwright) |
| `npm run typecheck` | TypeScript, strict mode |

First run of the end-to-end suite: `npx playwright install chromium`.

## How the camera is tested without a camera

Everything after landmark extraction is driven by a **synthetic eye**
(`src/testing/syntheticEye.ts`): a small forward model that, given where a
simulated reader looks, produces the `FaceObservation` the camera pipeline
would produce, with configurable noise, head pose and blinks. Scripted readers
(`src/testing/readingSimulator.ts`) look at the words of a real layout with a
"steady" or an "effortful" profile.

This is a **test instrument**, not a fallback:

- it lives in `src/testing/`, outside the production pipeline;
- in the browser it exists only in builds with `VITE_ENABLE_TEST_HOOKS=true`
  and only after a test selects it; the production bundle does not contain it;
- when it is active, the app shows a permanent "TEST MODE" banner;
- if the real camera fails, the app says so and offers to read without it.
  It never substitutes simulated gaze.

The synthetic eye proves that calibration, gaze estimation, fixation
detection, line mapping, difficulty assessment and adaptation are correct and
correctly wired. **It says nothing about real-world accuracy**, which depends
on the webcam, the light and the person (see manual validation below).

The real MediaPipe pipeline *is* exercised end to end with Chromium's fake
camera device (a test pattern): the model loads, inference runs, and the
"no face" path is verified.

## Results (2026-11-17)

Machine: Intel Core Ultra 5 125U (14 threads), 25 GB RAM, Windows 11,
Node 22.16, headless Chromium (Playwright 1.65).

### Unit and integration — 186 tests, all passing

| Area | Tests cover |
|---|---|
| Face geometry | eye measurement units, invariance to roll and distance, blink detection, head pose from matrix and from landmarks, frame quality reasons, lighting, delegate choice |
| Calibration | target layout, sample validation and outlier removal, 9-point quadratic fit validated on hold-out points, noisy signal never graded "good", unusable signal fails, "no face" abort, blinks ignored, unstable point re-asked, 5-point linear fallback |
| Gaze tracker | accuracy and confidence when calibrated, blinks never observations, loss and recovery, confidence drop and recalibration suggestion on head movement, off-screen rejection, repeated-loss suggestion, valid ratio, listener cleanup |
| Text and layout | language detection, paragraph/sentence/word parsing (French, Arabic, CRLF, empty, 2,500 words), French syllables, LTR and RTL line building, **bidirectional lines**, nearest word |
| Reading | fixation detection (merging, minimum duration, gaps never bridged), line tracking under vertical noise larger than the line spacing **in LTR and RTL**, return sweeps, forward/refixation/regression, vertical offset and drift, paragraph scope, reflow, window features, per-sentence effort |
| Difficulty | every indicator rule, personal baseline vs norms, text difficulty, insufficient-data reasons, warm-up, dominant need, confidence, fatigue only late, baseline blending and update |
| Adaptation | no change when reading is fine, one level at a time with cooldown, single spikes ignored, untrusted data ignored, hysteresis, anti-oscillation freeze, cap, teacher floor/ceiling, no camera, manual priority, freeze, change of dominant need, log; presets: **no letter spacing in Arabic**, taller Arabic lines, Arabic font, monotonic levels, WCAG AAA contrast |
| Closed loop (FR and AR) | steady reader left alone; effortful reader gets support, after the change, with reasons; patchy tracking → no adaptation; head moved → no adaptation and recalibration request; teacher switch-off respected; no-camera mode; pauses; summary contains no gaze coordinates; baseline update; disposal |
| Security | PBKDF2 determinism, non-extractable keys, Unicode normalisation, key wrapping with wrong key and tampering, sealed records readable only with the right private key, codes, input validation |
| Services (real IndexedDB in memory, real Web Crypto) | registration, sign-in, lockout and its delay, session restore after refresh and expiry, student creation, PIN reset, texts and assignment, **full teacher → parent → student → teacher journey**, gaze data dropped without consent, consent withdrawal, every cross-tenant and cross-role operation refused, records unreadable without a key grant, password change keeps access, every deletion path verified store by store, empty database, reports and safe CSV |

Coverage of the domain and service layers (lines): adaptation 83 %, auth 98 %,
data 100 %, difficulty 100 %, lib 99 %, reading 95 %, security 100 %,
services 96 %, session 87 %, vision 69 % (the camera adapters run only in a
browser and are covered by the end-to-end suite). The React screens are
covered by the end-to-end suite, not by unit tests.

### End-to-end — 15 tests in Chromium

| Test | Covers |
|---|---|
| Full journey | teacher creates student, uploads and assigns text → parent links with one-time code and consents → student signs in, onboarding, camera check, calibration, reading → steady reading leaves the page alone → effortful reading triggers an announced adaptation that changes the real typography → session ends → teacher sees the session and the logged adaptation → parent sees it, checks the access log, deletes it |
| Authentication | wrong credentials, lockout, session kept across refresh, empty class, sign-up validation |
| Without the camera | no consent, manual display controls change computed styles, pause, paragraph navigation, end screen, teacher sees "without consent" |
| Arabic | `dir="rtl"`, first word on the right, line height grows, letter spacing stays 0, Naskh font |
| Interface language | switch to Arabic, page mirrors, choice remembered |
| Long text, small screen | 2,400 words at 360×640, no horizontal scroll, navigation under 1.5 s |
| Real MediaPipe, fake camera | model loads and runs, "no face" coaching, ready button disabled, camera released |
| Camera failures | permission denied, no camera: clear message, reading continues |
| Calibration failure | child leaves: explained failure, retry offered, reading continues |
| Tracking interrupted | calm notice, no adaptation, automatic recovery |
| Diagnostics | live measurements, calibration, 9-target accuracy test completes |
| Performance | real inference rate and main-thread load |

Status of the last runs: all pass. One earlier full run was invalid because
the machine slept during it (the run took 2.9 h; timing assertions failed);
the affected tests passed on re-run.

### Performance

Per-frame processing after landmarks (`npm run test:perf`, Node):

| Step | Median | p95 |
|---|---|---|
| Landmarks → face observation | 3 µs | 9 µs |
| Observation → gaze → fixation → line/word → assessment → decision | 5 µs | 25 µs |
| Calibration fit and hold-out validation (≈900 frames) | 5 ms total | |
| Parsing a 5,000-word text | 1.2 ms | |

The analysis is negligible against the 33 ms frame budget; the cost is
MediaPipe inference.

Browser (`e2e/performance.spec.ts`, headless Chromium, fake camera, 640×480):

| Configuration | Inference | Frames analysed | Longest main-thread task |
|---|---|---|---|
| GPU delegate on software WebGL (before fix) | 101 ms | 7.5 /s | 244 ms |
| CPU delegate (chosen automatically now) | 22–27 ms | 12–17 /s | 59–127 ms |

Finding: on machines without hardware WebGL, MediaPipe's GPU path is
emulated and about 4× slower than its CPU path. The source now detects
software renderers, re-checks after 30 frames, and caps inference at 50 % of
main-thread time. Real hardware with a GPU has not been measured yet: use the
diagnostics page (numbers update live) and record them here.

Bundle (production build): app JavaScript 460 KB (142 KB gzip), loaded at
start; MediaPipe JavaScript 154 KB (45 KB gzip), loaded only when the camera
is used; CSS 30 KB (7 KB gzip); fonts 444 KB (woff2, loaded on demand by the
browser). Vision assets, fetched only when the camera is used: model 3.6 MB,
WASM runtime 14 MB (cached by the browser after the first use).

## Manual validation

These need a person, a webcam and a real browser. Run them before any
demonstration on new hardware.

1. **Camera and consent**: as a parent, grant consent; as the student, choose
   the camera; check the camera light turns on, the face check coaches
   correctly (move away, turn the head, cover the camera), and the light turns
   off when leaving the reading screen.
2. **Calibration**: complete the star game; note the grade. Repeat with the
   light behind you, and with glasses: grades should drop, not lie.
3. **Accuracy protocol** (diagnostics page): sit at a normal distance
   (50–70 cm), calibrate, run the accuracy test, export the JSON. Repeat 3
   times per person and per condition (good light, dim light, glasses).
   Report mean and median error in px and in % of the screen diagonal, per
   condition, with the screen size and webcam. Do not quote an accuracy
   figure before this has been done with several people.
4. **Reading**: read a French text and an Arabic text naturally; the helper
   indicator should stay green and the page should not change. Then read very
   slowly, re-reading words: within a minute or two the page should offer more
   support, and "put it back" should undo it.
5. **Tracking loss**: look away for a few seconds: calm notice, then recovery.
6. **Real hardware performance**: note FPS, inference time and delegate on the
   diagnostics page for each target laptop.
