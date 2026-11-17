# Contributing

## Set-up

```bash
npm install          # also prepares the vision assets (see README)
npm run dev          # http://localhost:5173
```

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run test:e2e     # first time: npx playwright install chromium
npm run build
```

All must pass. If you change behaviour, change or add the tests that describe it.

## Rules of the code base

- **Layers depend downwards only** (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
  `vision/`, `reading/`, `difficulty/` and `adaptation/` stay free of React and,
  apart from their thin browser adapters, of the DOM.
- **No global event bus.** An object that emits events owns a typed `Emitter`
  and its owner disposes it.
- **Never treat an unreliable measurement as an observation.** Invalid gaze
  samples are passed on as invalid; nothing downstream interpolates them.
- **Never label a child.** The engine describes support needs
  (decoding, line tracking, attention, fatigue), never conditions. Do not add
  diagnostic vocabulary to code, data or UI.
- **Every user-facing string goes through i18n**, in both `fr.ts` and `ar.ts`.
  The compiler rejects a key missing from Arabic.
- **Use logical CSS properties** (`margin-inline-start`, not `margin-left`) so
  the interface mirrors correctly in Arabic.
- **No letter spacing on Arabic text.**
- **Every service method checks role and ownership.** Add a refusal test to
  `tests/services/workflow.test.ts` for any new operation.
- **No network requests and no CDN assets.** Everything is served from the
  app's own origin; the production CSP enforces it.
- **No new dependency without a reason** written in the pull request.
- `src/testing/` holds test instruments. Production code must not import it,
  except `vision/sourceFactory.ts` behind the `VITE_ENABLE_TEST_HOOKS` flag.

## Style

TypeScript strict mode, no `any`. Small functions with a comment explaining
*why* when the reason is not obvious. Tunable numbers live in named config
objects next to the code that uses them, with their unit.

## Commits

Imperative subject line under 72 characters ("Add hysteresis to the
adaptation controller"), a body explaining why when it is not obvious.
