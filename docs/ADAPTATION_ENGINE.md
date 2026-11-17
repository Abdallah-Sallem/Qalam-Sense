# Difficulty detection and adaptation

Qalam-Sense is an assistive reading tool, **not a diagnostic system**. Nothing
in the engine names a condition. It estimates, from reading behaviour, which
kind of presentation support might help right now, and it is allowed to say
"I don't know".

## Difficulty engine (`src/difficulty/`)

```
window features ─► sufficiency check ─► personal baseline ─► indicators
                         │                                        │
                 "insufficient data"                support dimensions
                                                                  │
                                         support need + dominant need + confidence
```

### 1. Sufficiency

A 30-second window is assessed only if it spans at least 12 s, at least 55 %
of gaze samples were valid, and it contains at least 10 fixations on the text.
Otherwise the result is `insufficient-data` with the reason (`low-tracking`,
`few-fixations`, `warming-up`). No evidence is never treated as evidence of
ease or of difficulty.

### 2. Personal baseline

Webcam fixations are coarser than laboratory ones, so published reading norms
do not apply. Each child is compared **only with themselves**, per language:

- the first 4 sufficient windows of a session form today's baseline;
- a baseline stored from earlier sessions is blended in (weight 0.6);
- at the end of a session the stored baseline moves 30 % towards the windows
  in which no particular support was needed. Effortful windows never pull the
  baseline, so a hard day does not redefine "normal".

### 3. Indicators

Each indicator is a linear ramp between two documented limits
(`difficulty/indicators.ts`), with its measured value and reference kept for
explanation:

| Indicator | Measures | Ramp (score 0 → 1) |
|---|---|---|
| Prolonged fixations | median fixation / baseline | 1.2× → 1.8× |
| Frequent regressions | backward moves per fixation | 0.18 → 0.40 |
| Slow progress | words/min / baseline | 0.75× → 0.35× |
| Stagnation | seconds without a new word | 7 s → 20 s |
| Line instability | line changes going back or skipping (≥ 3 changes) | 25 % → 70 % |
| Fixation volatility | duration variability / baseline | 1.3× → 2.2× |
| Long pauses | pauses > max(900 ms, 3× median) per minute | 2 → 8 |
| Off-text | share of fixation time off the text | 25 % → 60 % |
| Fatigue signs | blink increase, session length, late slowing (after 3 min) | combined |

Text difficulty set by the teacher shifts the expectations: a "difficile"
text is expected to be read 15 % slower with 12 % longer fixations.

### 4. Support dimensions

Indicators combine with fixed weights into four kinds of support:
**decoding** (fixations, regressions, speed, pauses), **line tracking**
(line instability, regressions), **attention** (off-text, stagnation,
volatility) and **fatigue**. The overall support need is
0.75 × the strongest dimension + 0.25 × their mean. A dimension is named as
dominant only above 0.3.

### 5. Confidence

`confidence = coverage × calibration factor × familiarity`, where coverage
ramps with the share of valid samples, the calibration factor is 1 / 0.8 /
0.5 for good / fair / poor, and familiarity grows with the number of windows
behind the baseline.

### Why rules and not machine learning

There is no labelled dataset of children reading with webcam gaze in Arabic
and French, and fabricating one would make any trained model meaningless.
Transparent rules can be inspected, explained to a teacher and adjusted.
Collecting consented, anonymised session summaries to evaluate and later
learn these thresholds is listed as future work.

## Adaptation controller (`src/adaptation/controller.ts`)

Five support levels would be too many to distinguish; Qalam-Sense uses four:
0 (plain) to 3 (strong). The controller decides **when** the level changes and
is deliberately slow and sticky, because a page that keeps reshaping itself is
worse than one that never adapts.

| Safeguard | Setting |
|---|---|
| Confidence gate | assessments with confidence < 0.5 are ignored |
| Smoothing | exponential, weight 0.4 on the newest need |
| Thresholds to be at level 1 / 2 / 3 | 0.35 / 0.55 / 0.75 |
| Hysteresis | must fall 0.15 below the threshold to go down |
| Persistence | 2 consecutive assessments to go up, 6 to go down |
| Cooldown | 25 s after any change before going up, 60 s before going down |
| Step size | one level at a time |
| Anti-oscillation | a 2nd direction reversal within 3 min freezes automation at the more supportive level |
| Cap | at most 8 automatic changes per session |
| Manual priority | any manual adjustment pauses automation for 2 min; "keep it like this" stops it |
| Teacher limits | per-student floor (start level) and ceiling, or automation off |

Assessments arrive every 5 s, so the fastest possible first adaptation is
about 10 s after sustained need appears, and the fastest return to a lower
level is a full minute of calm reading.

Every change is logged with time, trigger (automatic / student), levels,
dominant need, the indicators behind it and the confidence. Teachers and
parents see this log in plain language.

## Presentation (`src/adaptation/presets.ts`, `applier.ts`)

The level and dominant need resolve into: font family, size, letter spacing,
word spacing, line height, paragraph spacing, line length (characters),
background theme, contrast, and focus mode (dim other paragraphs, or line
bands). The dominant need shifts emphasis by one step: decoding → spacing,
line tracking → line height, narrower lines and line bands, attention →
calmer theme and narrower lines, fatigue → larger text.

**Script-specific rules:**

- Arabic is cursive: letter spacing breaks the joins between letters, so it is
  **always 0** for Arabic (enforced in the presets and again in CSS). Extra room
  comes from word spacing, size and line height.
- Arabic needs taller lines for ascenders, descenders and vowel marks, so its
  line-height scale starts higher (1.95 vs 1.7).
- The Latin dyslexia-oriented fonts have no Arabic glyphs; Arabic always uses
  Noto Naskh Arabic. French uses Lexend at level 0 and Atkinson Hyperlegible
  above, unless the teacher chooses a font (including OpenDyslexic).
- All themes meet WCAG AAA contrast (7:1), verified by a test.

**No layout jumps:** changes are applied as CSS custom properties with
0.7 s eased transitions; during the transition the paragraph being read is
held at the same place on screen by compensating the scroll position every
frame. The layout model is then re-measured so gaze mapping stays correct.
`prefers-reduced-motion` disables the animation.

**The child stays in control:** a display panel offers text size, spacing,
colours, focus mode and "more / less help". Every automatic increase is
announced ("I made the text a little easier to read") with an immediate
"put it back" button.
