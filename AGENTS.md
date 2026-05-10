# AGENTS.md — Teichos

Teichos is a Manifest V3 browser extension. Keep this file short and repo-specific; treat the
repository itself as the source of truth.

## Agent workflow

Use harnesses and canonical files instead of stale prose:

1. Start with the user task and read the files that actually control the behavior you are changing.
2. Prefer executable harnesses (`package.json` scripts, tests, CI workflows, build scripts) over
   restating their contents here.
3. Update the canonical file when behavior changes; only update `AGENTS.md` when the agent workflow
   itself changes.

## Read these files first

- `/home/runner/work/Teichos/Teichos/package.json` — npm scripts and the fastest valid check loop.
- `/home/runner/work/Teichos/Teichos/.github/workflows/ci.yml` — the required CI jobs and ordering.
- `/home/runner/work/Teichos/Teichos/README.md` — local development and debugging workflow.
- `/home/runner/work/Teichos/Teichos/public/manifest.json` — extension permissions and MV3 config.
- `/home/runner/work/Teichos/Teichos/scripts/build.ts` — bundle entry points and output behavior.
- `/home/runner/work/Teichos/Teichos/src/` and `/home/runner/work/Teichos/Teichos/test/` — product code and mirrored tests.

Read the config file itself when working in that area instead of relying on a summary here:

- `/home/runner/work/Teichos/Teichos/.prettierrc`
- `/home/runner/work/Teichos/Teichos/eslint.config.mjs`
- `/home/runner/work/Teichos/Teichos/tsconfig.json`
- `/home/runner/work/Teichos/Teichos/tsconfig.test.json`
- `/home/runner/work/Teichos/Teichos/tsconfig.scripts.json`
- `/home/runner/work/Teichos/Teichos/.vscode/`

## Repo shape

- `src/background/` — MV3 service worker.
- `src/popup/`, `src/options/`, `src/blocked/` — extension UI entry points.
- `src/shared/` — shared types, helpers, storage logic, and browser API wrappers.
- `public/manifest.json` — copied into the built extension.
- `scripts/build.ts` — builds `dist/`, which is what Playwright and local extension loading use.

Keep shared logic in `src/shared/` when multiple extension contexts need it.

## Real validation loop

Match the repo's actual harnesses instead of inventing new ones:

1. `npm ci --prefer-offline --no-audit`
2. `npm run check:fast` for formatting, linting, source/test typechecking, and unit tests.
3. `npm run build`
4. `npm run test:e2e`
5. `npm run check` before handoff when you need the full local gate.
6. `npm run package` only when you need the distributable zip artifact.

CI runs the same loop in separate jobs: `checks`, `tests`, `build`, then `playwright`, with the
Playwright job consuming the built `dist/` artifact from the build job.

If Playwright Chromium is missing locally, install it with `npm run playwright:install` and rerun
`npm run test:e2e`.

## Extension-specific guardrails

- This is MV3: background logic must work as a service worker and should not rely on persistent in-memory state.
- Keep permissions minimal and verify permission changes in `public/manifest.json`.
- Prefer shared types for cross-context message and storage contracts.
- Validate behavior with the existing harness before handoff; do not add ad hoc workflows when the repo already has one.
