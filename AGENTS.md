# AGENTS.md — Teichos

Keep this file short and repo-specific.

## Purpose

Use this file as a routing layer for agents, not as a second copy of repository config.
Prefer Harness-style guidance: point to the live source of truth, keep instructions compact,
and avoid examples that can drift from the real files.

## Source-of-truth files

Read the real files before making assumptions:

- Product and user workflow: `README.md`
- Extension manifest and permissions: `manifest.json`
- Build pipeline: `scripts/build.ts`
- Package scripts and validation commands: `package.json`
- TypeScript config: `tsconfig.json`, `tsconfig.test.json`, `tsconfig.scripts.json`
- Lint and formatting config: `eslint.config.mjs`, `.prettierrc`
- VS Code workflow: `.vscode/extensions.json`, `.vscode/launch.json`, `.vscode/settings.json`, `.vscode/tasks.json`
- CI expectations: `.github/workflows/ci.yml`
- Browser behavior and regression coverage: `test/unit`, `test/e2e`

## Repository map

- `src/background`: service worker logic
- `src/options`: options UI
- `src/popup`: popup UI
- `src/blocked`: blocked-page UI
- `src/shared`: shared types, storage, filter logic, and helpers

## Agent workflow

1. Read the relevant source-of-truth files first.
2. Prefer updating the real config or documentation file over restating it here.
3. Keep changes minimal and consistent with the existing structure.
4. Validate with the repo's existing npm scripts from `package.json`.
5. If a command fails because local prerequisites are missing, install the documented prerequisite and rerun.

## Extension-specific reminders

- Manifest V3 service worker code must stay event-driven and should not rely on persistent in-memory state.
- Prefer the shared logic in `src/shared` over duplicating types or storage behavior across entry points.
- Treat tests as executable documentation: update or read the matching unit/e2e tests before changing behavior.

## When updating this file

Only add durable, repo-wide guidance here.
If a detail already lives in a committed file, link to that file instead of copying its contents.
