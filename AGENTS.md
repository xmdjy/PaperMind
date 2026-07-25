# Repository Guidelines

## Project Structure & Module Organization

PaperMind is a TypeScript, Vue 3, and Electron desktop application.

- `src/views/` contains route screens; reusable UI belongs in `src/components/`.
- `src/stores/` contains Pinia stores; `src/utils/` holds PDF, indexing, Markdown, and model logic.
- `src/tests/` contains Vitest suites and the shared IPC mock in `setup.ts`.
- `electron/` contains the main process, preload bridge, IPC handlers, and SQLite layer.
- `public/` stores static runtime assets.
- `dist/`, `dist-electron/`, and `release/` are generated outputs; do not edit them directly.

When changing the database API, keep `electron/db/schema.ts`, `electron/db/index.ts`, `electron/preload.ts`, and `src/types/db.d.ts` synchronized.

## Build, Test, and Development Commands

- `npm install` installs dependencies and rebuilds native modules.
- `npm run dev` starts Vite and Electron for development.
- `npm run typecheck` runs strict Vue/TypeScript checks.
- `npm test` runs all Vitest suites once.
- `npm run test:watch` reruns tests during development; `npm run test:ui` opens the test UI.
- `npm run build` type-checks, bundles the application, and creates installers in `release/`.
- `npm run rebuild` rebuilds `better-sqlite3`.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Prefer Vue `<script setup lang="ts">`, Composition API, and explicit shared-data interfaces. Name components in PascalCase (`ChatPanel.vue`), utilities in camelCase (`pageIndex.ts`), and tests `*.test.ts`.

No standalone formatter or linter is configured. Match neighboring code and run `npm run typecheck` before submitting.

## Testing Guidelines

Tests use Vitest with `jsdom` and optionally Vue Test Utils. Add focused tests under `src/tests/`, especially for stores, IPC, PDF parsing, and model requests. Mock `window.db` through `src/tests/setup.ts`. No coverage threshold is enforced, but cover new behavior and regressions. Run `npm test` and `npm run typecheck`.

## Commit & Pull Request Guidelines

Recent history favors short Conventional Commit-style subjects such as `fix:latex formula rendering` and `feat: multi-profile LLM config`. Prefer `type: concise description` using `feat`, `fix`, `test`, `docs`, or `refactor`.

Create branches such as `feat/abstract-command`. Pull requests should explain the change, list verification commands, link issues, call out breaking or database changes, and include screenshots for UI updates.

## Security & Configuration

API keys are stored locally in SQLite settings and requests go directly to configured providers. Never commit real credentials, user PDFs, databases, or generated application bundles.
