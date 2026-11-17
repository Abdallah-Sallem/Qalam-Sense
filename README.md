# Qalam-Sense — قلم-سنس

**A reading companion that adapts the text to how a child is reading, in
Arabic and in French, using only an ordinary laptop webcam, entirely on the
device.**

Qalam-Sense is an assistive learning tool, **not a medical or diagnostic
system**. It never labels a child; it adjusts how text is presented and gives
teachers and parents a transparent account of what it observed and why it
changed anything.

## The problem

Many children in Tunisian classrooms read in two scripts that work very
differently: Arabic (cursive, right to left, with vowel marks) and French
(Latin, left to right). Children who struggle with reading, including
children with dyslexia or attention difficulties, benefit from adapted
presentation: larger text, more space between words and lines, shorter lines,
calmer colours, a visual guide. But the right adaptation changes from child
to child and from one moment to the next, and a teacher with thirty pupils
cannot watch each of them read. Specialised eye trackers that could do it cost
far more than a school can spend.

## What it does

1. The teacher creates student accounts, uploads texts and assigns them.
2. A parent links their child with a one-time code and decides whether the
   camera may be used.
3. The child reads. If they choose to, a webcam pipeline estimates where on
   the text their eyes are, after a 30-second "follow the star" calibration.
4. The system turns gaze into reading behaviour (fixations, regressions,
   progress, line changes) and compares it with the child's own usual reading.
5. When reading becomes clearly and consistently effortful, the text gently
   becomes easier to read. The child can undo it, adjust anything by hand, or
   read without the camera at all.
6. Teachers and parents see each session: pace, the adaptations made with
   their reasons, passages that took more effort, and how reliable the
   measurement was.

## Main features

- **Webcam reading observation** with MediaPipe Face Landmarker (iris
  landmarks), per-child calibration validated on hold-out points, confidence
  on every sample, tracking-loss detection, recovery and recalibration.
- **Reading-aware processing**: line and word tracking that holds up when gaze
  error exceeds the line spacing, correct for right-to-left Arabic, left-to-right
  French and mixed lines.
- **Explainable difficulty indicators** against a personal baseline, with an
  explicit "not enough data" answer.
- **Stable adaptation**: confidence gating, hysteresis, cooldowns,
  anti-oscillation, one level at a time, reading position kept in place,
  student overrides always win.
- **Script-aware typography**: never letter-spaces Arabic; Naskh font and
  taller lines for Arabic; Lexend, Atkinson Hyperlegible or OpenDyslexic for
  French; optional French syllable colouring; WCAG AAA contrast.
- **Teacher dashboard**: students, texts, assignments, per-student support
  settings, session history, trend chart, effortful passages, CSV export,
  printable report.
- **Parent space**: linking, consent with plain-language explanation, reading
  history, access log, real deletion.
- **Privacy by construction**: no server, no network requests, no stored
  images or gaze points, reading records encrypted so that only the teacher
  and linked parents can read them.
- **Tracking diagnostics** page with live measurements and a controlled
  accuracy test against known screen targets.
- Complete **French and Arabic interface**, mirrored layout in Arabic.

## Architecture

```
webcam → landmarks → eye geometry → calibrated gaze (+confidence)
       → fixations → line/word in the text → reading features (30 s)
       → assessment vs personal baseline → adaptation policy
       → typography (CSS variables) → the child reads → …
```

A single-page React application with no backend; all data in IndexedDB. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layers and the closed
loop, [docs/EYE_TRACKING.md](docs/EYE_TRACKING.md) for the vision pipeline,
[docs/ADAPTATION_ENGINE.md](docs/ADAPTATION_ENGINE.md) for detection and
adaptation, and [docs/PRIVACY_AND_SECURITY.md](docs/PRIVACY_AND_SECURITY.md)
for the security model. The audit of the earlier prototype that led to this
design is in [docs/AUDIT.md](docs/AUDIT.md).

## Technology

| Concern | Choice |
|---|---|
| UI | React 19, TypeScript (strict), Vite |
| Computer vision | MediaPipe Tasks Vision — Face Landmarker (WASM + WebGL/CPU) |
| Storage | IndexedDB |
| Cryptography | Web Crypto API (PBKDF2, HKDF, ECDH P-256, AES-GCM) |
| i18n | i18next (French, Arabic) |
| Fonts | Self-hosted via Fontsource |
| Tests | Vitest, fake-indexeddb, Playwright |

## Prerequisites

- Node.js 20 or newer (developed with 22) and npm.
- A Chromium-based browser, Firefox or Safari (recent versions). The camera
  needs `https://` or `localhost`.
- Internet access once during `npm install`, to download the 3.6 MB face
  model. After that, nothing is downloaded at run time.

## Installation

```bash
git clone https://github.com/bayayaich2/qalam-sense.git
cd qalam-sense
npm install
```

`npm install` runs `scripts/setup-vision-assets.mjs`, which copies the
MediaPipe WASM runtime into `public/vision/` and downloads the Face
Landmarker model. If the download fails (e.g. behind a proxy), run
`npm run setup:vision` again, or download the model from the URL it prints
and save it as `public/vision/face_landmarker.task`. Without the model the
app still works, without the camera, and says so.

## Configuration

No secrets and no environment variables are required. `.env.example`
documents the only flag:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_ENABLE_TEST_HOOKS` | `false` | Enables the synthetic gaze source used by end-to-end tests. Never enable for real use (the app shows a "TEST MODE" banner). |

## Development

```bash
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit + integration
npm run test:e2e     # end-to-end (first: npx playwright install chromium)
npm run test:perf    # performance budgets
npm run test:coverage
```

To try it: open the app, create a teacher account, add a student (note the
login, PIN and parent code), add a text and assign it; create a parent
account, link the child with the parent code and allow the camera; sign out
and sign in as the student.

## Build and deployment

```bash
npm run build        # → dist/
npm run preview      # serves dist/ on http://localhost:4173
```

`dist/` is a static site (relative paths, hash routing): copy it to any
static host or a school web server, served over **HTTPS** (required for the
camera). The production build carries a strict Content-Security-Policy that
allows only the app's own origin. Nothing needs to run on the server.

## Testing

186 unit and integration tests and 15 end-to-end tests, including the
complete teacher → parent → student → teacher journey with calibration and an
automatic adaptation in a real browser. Details, results and the manual
validation protocol: [docs/TESTING.md](docs/TESTING.md).

## Status

| Area | Status |
|---|---|
| Accounts, roles, texts, assignment, consent, deletion | Implemented, tested |
| Webcam pipeline, calibration, confidence, loss and recovery | Implemented, tested with a synthetic eye and with MediaPipe on a fake camera |
| Reading-aware mapping, difficulty indicators, adaptation | Implemented, tested |
| Teacher and parent dashboards, export | Implemented, tested end to end |
| Gaze accuracy on real children and webcams | **Not yet measured** — protocol ready on the diagnostics page |
| Difficulty thresholds | Rule-based, set from the literature and simulation; **not validated with children** |
| Performance on real school laptops | Measured only in headless Chromium so far |

## Current limitations

- Webcam gaze estimation is coarse: it can tell which line or region is being
  read, with help from the reading model, not which letter. No accuracy
  figure is claimed until it has been measured with people.
- Calibration is valid near the head pose at which it was done; large
  movements reduce confidence and prompt a recalibration.
- Difficulty indicators are transparent rules, not a validated model.
- Data lives in one browser on one device: no sync, no backup, no password
  recovery. Clearing browser data deletes everything.
- Face inference runs on the main thread; on slow machines it is throttled to
  keep the page responsive, at the cost of fewer gaze samples.
- Arabic syllable colouring is not available (French only).

## Future improvements (prioritised)

1. Run the accuracy protocol with several children, webcams and lighting
   conditions; publish the numbers.
2. Measure performance on representative school laptops; move inference to a
   Web Worker with OffscreenCanvas where supported.
3. Evaluate the difficulty thresholds against teacher judgement on consented,
   anonymised session summaries; only then consider a learned model.
4. Optional school server for accounts, backup and multi-device use, keeping
   end-to-end encryption of reading records.
5. Arabic reading aids (diacritics toggle, word-by-word highlighting).
6. Audio support: read-aloud of a word the child is stuck on.
7. Accessibility audit with assistive technologies and with children.

## Credits

Face Landmarker model and MediaPipe © Google, Apache 2.0. Fonts: Atkinson
Hyperlegible (Braille Institute), Lexend, Noto Naskh Arabic (Google),
OpenDyslexic — all under the SIL Open Font License.
