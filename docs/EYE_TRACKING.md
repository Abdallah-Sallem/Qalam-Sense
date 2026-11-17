# Eye tracking

## Choice of technology

| Option | Verdict |
|---|---|
| **WebGazer.js** (previous implementation) | Rejected. Learns a pixel-appearance regression only from user clicks; with no calibration its output is noise. Few hooks for confidence or quality, unmaintained since 2022, loaded from a CDN. |
| **MediaPipe Face Landmarker** | **Chosen.** 478 facial landmarks including both irises from an ordinary webcam, maintained by Google, runs in the browser on the GPU (WebGL) with CPU fallback, model and WASM served from this app. Gives head pose and blink scores as well. |
| Appearance-based deep gaze models (e.g. trained on GazeCapture) | Not chosen for now. Better head-pose tolerance in principle, but heavier, and no openly licensed browser-ready model fitted the size and licence constraints. Possible future work. |

## Pipeline

1. **Camera and permission** (`vision/camera.ts`). 640×480 at up to 30 fps.
   Browser failures are mapped to a small set of causes shown to the child:
   permission denied, no camera, camera in use, insecure context, model missing.
2. **Face and landmark detection** (`vision/cameraSource.ts`). MediaPipe in
   `VIDEO` mode, one face, with blendshapes and the facial transformation matrix.
3. **Eye geometry** (`vision/faceGeometry.ts`). For each eye, the iris centre is
   expressed relative to the eye corners, in units of eye width, along and
   across the eye's own axis. This makes the signal independent of the
   distance to the camera and of head tilt (both verified by tests).
   Head yaw/pitch/roll come from the transformation matrix.
4. **Frame quality** (`vision/frameQuality.ts`). A frame is rejected with an
   explicit reason when there is no face, the face is too far, too close or
   off-centre, the head is turned, or the eyes are closed. Brightness is
   sampled from a 32×24 thumbnail once a second (pixels discarded immediately)
   to detect a too dark, too bright or flat image.
5. **Gaze estimation** (`vision/gazeModel.ts`). Ridge regression from 8
   features (binocular iris h/v, lid openness, yaw, pitch, face x/y, face
   scale) with quadratic terms for the iris, fitted per child during
   calibration. Features are standardised with a floor on their spread so that
   small head movements after calibration cannot blow up the prediction.
6. **Coordinates** are CSS pixels of the viewport; the reading layer adds the
   scroll offset to obtain document coordinates.
7. **Temporal smoothing** with a One Euro filter: strong smoothing during
   fixations, little lag during saccades. Rejected samples reset the filter so
   they cannot leak into later estimates.
8. **Confidence** = calibration grade × head-pose factor × eye-openness
   factor. The head-pose factor falls as the head leaves the "envelope" of
   poses seen during calibration.
9. **Validity**: a sample is used only if confidence ≥ 0.3 and the estimate
   lands on or near the screen. Invalid samples are passed on *as invalid*;
   nothing downstream fills the gaps.
10. **Tracking loss and recovery** (`vision/gazeTracker.ts`). No valid sample
    for 1.5 s → `lost`; 5 consecutive valid frames → `tracking` again.
    Recalibration is suggested when the head stays outside the calibration
    envelope for 8 s, after 3 losses within a minute, or when the reading
    layer detects sustained vertical drift.

## Calibration

- **13 targets**: a 3×3 grid used to fit the model, plus 4 hold-out targets
  used only to measure accuracy on positions the model has never seen.
- **Why 9 fit points**: the quadratic model has 12 coefficients per axis;
  nine positions spanning the corners constrain its curvature, five cannot.
  A 5-point session is accepted only as a fallback that fits a linear model
  and reports leave-one-out error.
- **Child-friendly**: a star glides from point to point ("follow the star
  with your eyes"); no clicks. About 30 seconds.
- **Sample validation**: samples right after the star arrives are discarded
  (the eye is still landing); outliers are removed with a median-absolute-
  deviation test; a point is accepted only if the eye was demonstrably still.
  An unstable point is asked for once more at the end instead of being fitted.
- **Quality grade** is computed from accuracy and jitter combined, as a
  fraction of the screen diagonal: good ≤ 6 %, fair ≤ 11 %, poor beyond;
  above 20 % calibration is reported as failed.
- **Graceful failure**: no face for 7 s aborts with a reason; the child gets
  concrete tips (light, head still, glasses) and can retry up to 3 times, or
  read without the camera. A "poor" calibration can still be used if the
  child chooses; confidence is lowered accordingly.

## Reading-aware processing

Gaze points become reading events in `src/reading/`:

- **Fixations**: streaming dispersion-threshold detection (I-DT). The
  dispersion threshold is derived from the measured calibration jitter.
  Gaps of invalid samples end a fixation; they are never bridged.
- **Layout model**: every word of the rendered text is measured once per
  reflow and grouped into lines *in logical reading order*, so a French word
  inside an Arabic line keeps the line intact.
- **Line and word mapping** (`readingMapper.ts`): an online Viterbi filter
  over "which line is being read". Emission cost: vertical distance to the
  line scaled by measured vertical precision. Transition cost: staying is
  free, moving to the next line requires a jump back along the line (a return
  sweep), changing line while moving forward is expensive, skipping is rare.
  Progress along a line is measured from the line *start*, which is the left
  edge in French and the right edge in Arabic, so the same logic serves both
  scripts. A slow vertical offset between gaze and text is learned and
  reported as drift when it exceeds 1.2 line pitches.
- **Move classification** on word order, not on x coordinates: forward,
  refixation, regression (only when larger than the horizontal precision),
  line advance, line back, line skip, off-text.
- **Window features** (`readingAnalyzer.ts`, 30 s window): share of valid
  samples, fixation count, median duration and variability, regression rate,
  words advanced and words per minute, time without progress, line
  instability, long pauses, off-text ratio. Per-sentence dwell time and
  returns are kept for the teacher's "effortful passages" view.

Font size or spacing changes rebuild the layout; the reading position (a word
index) carries over and the learned vertical offset is rescaled.

## Diagnostics

Teachers have a **Tracking diagnostics** page (top bar) showing: the camera
feed with landmarks (eye corners and irises highlighted), face detection
status, live estimated gaze point, confidence and validity, calibration
quality per axis, FPS, inference time and delegate, frame-to-gaze latency,
lighting, head pose and distance from the calibration pose, tracking state,
loss events and recalibration suggestions.

### Controlled accuracy test

After calibrating on the diagnostics page, **Test de précision** shows 9
targets at (0.2, 0.5, 0.8) × (0.2, 0.5, 0.8) of the screen, deliberately
different from the calibration grid. For each target it waits 0.9 s for the
eye to settle, collects valid samples for 1.3 s, and reports mean error,
bias (Δx, Δy) and jitter. **Exporter le rapport** downloads all measurements
as JSON with the browser and screen details. Protocol for a measurement
campaign: see [TESTING.md](TESTING.md#manual-validation).

## Limitations (honest)

- **Accuracy on real faces has not been measured yet.** The automated tests
  use a synthetic eye whose noise is a parameter; they prove the pipeline is
  correct, not how accurate it is with a given webcam and child. No accuracy
  figure should be quoted until the protocol above has been run with people.
- Published webcam iris trackers typically reach errors of several degrees of
  visual angle, i.e. a few centimetres on a laptop screen at normal distance.
  That is enough to know which **line or region** is being read with help
  from the reading model, **not which letter**. The product is designed around
  that: it reasons about lines, progress and rhythm, never single letters.
- The regression is valid only near the head pose of calibration. Leaning
  back or moving sideways lowers confidence and eventually triggers a
  recalibration suggestion.
- Glasses with strong reflections, very low light, strong backlight and
  heavy make-up degrade landmark detection.
- Blink-based fatigue estimates are weak signals and are used only to offer
  a break or gentler presentation.
- Inference runs on the main thread (see ARCHITECTURE.md, performance design).
