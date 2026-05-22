# AGENTS.md - Teichos

Keep this file short and repo-specific.

## Purpose

Use this file as a routing layer for agents, not as a second copy of repository config.
Prefer harness-style guidance: point to the live source of truth, keep instructions compact,
and avoid examples that can drift from the real files. OpenAI's harness engineering writeup
recommends treating repository knowledge as the system of record and `AGENTS.md` as a table of
contents, not an encyclopedia: https://openai.com/index/harness-engineering/

The goal is agent legibility. Future agents should be able to inspect the repository, understand
the product boundaries, run the checks, and improve the durable harness when the current one is
missing a rule, test, or source-of-truth document.

## Source-of-truth files

Read the real files before making assumptions:

- Product and user workflow: `README.md`
- Extension manifest and permissions: `manifest.json`
- Build pipeline: `vite.config.ts`
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
4. Inspect nearby implementation and matching tests before changing behavior.
5. Validate with the repo's existing npm scripts from `package.json`.
6. If a command fails because local prerequisites are missing, install the documented prerequisite and rerun.
7. If a repeated issue would be better caught by automation, add or update the relevant test, type,
   lint rule, script, or documentation source of truth instead of adding more prose here.

## Extension-specific reminders

- Manifest V3 service worker code must stay event-driven and should not rely on persistent in-memory state.
- Prefer the shared logic in `src/shared` over duplicating types or storage behavior across entry points.
- Treat tests as executable documentation: update or read the matching unit/e2e tests before changing behavior.
- Validate external browser, storage, and message shapes at the boundary before depending on them.
- Keep popup, options, blocked-page, background, and shared modules within their existing ownership boundaries
  unless the change intentionally moves behavior into a shared layer.

## Harness maintenance

Use review feedback and recurring defects to improve the harness in durable places:

1. Prefer executable checks: tests, TypeScript types, lint rules, scripts, and CI.
2. Prefer source documentation for product, architecture, and workflow decisions.
3. Use this file only for stable repo-wide routing and invariants.
4. When documentation and code disagree, trust the code and tests first, then update the stale document.

## When updating this file

Only add durable, repo-wide guidance here.
If a detail already lives in a committed file, link to that file instead of copying its contents.
Keep this file small enough that agents can read it at the start of every task without crowding out
the task, code, tests, and source-of-truth files.
