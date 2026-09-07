# Academic UI Implementation Plan

> **For agentic workers:** Execute in this session using the executing-plans workflow. Track each task below and validate the final interface with local fixture data.

**Goal:** Give PaperMind a warm, readable academic interface for managing, reading, annotating, and questioning papers.

**Architecture:** Keep the existing Vue views, Pinia stores and IPC contracts. Put shared visual tokens and Element Plus overrides in the global stylesheet, scoped layouts in their components, and library filtering in a small pure utility.

**Tech Stack:** Vue 3, TypeScript, Element Plus, Vitest, Vite, Electron.

---

- [x] Add `src/tests/libraryFilters.test.ts`, covering combined search/status, metadata search, sorting, and input immutability. Run `npm test -- src/tests/libraryFilters.test.ts` before implementing `src/utils/libraryFilters.ts`.
- [x] Replace the dark/teal palette in `src/styles/global.css` with warm paper surfaces, walnut accents, legible secondary text, system fonts, and complete Element Plus tokens. Preserve focus indicators and reduced motion.
- [x] Update `src/App.vue` with a quiet navigation rail, a live list of papers being read, and a compact reading mode.
- [x] Update `src/views/LibraryView.vue` to show a literature list, search, reading filters, sort control, actionable empty states and coordinated import dialogs. Keep import and knowledge-base actions intact.
- [x] Update `src/views/ReaderView.vue` and `src/components/PdfViewer.vue` for paper-like surfaces, responsive reading, labelled controls, and a splitter based on its actual container bounds.
- [x] Update `src/components/ChatPanel.vue`, `src/views/ChatView.vue`, `src/components/NotesPanel.vue` and `src/components/ParamPanel.vue` for comfortable text, useful prompt starters, a unified composer and on-demand settings. Extract ChatSources.vue so desktop and mobile share the same source-selection UI; use Element Plus drawers for modal focus management.
- [x] Coordinate `src/views/SettingsView.vue` and update the interface description in `README.md`.
- [x] Run `npm test` and `npm run typecheck`. Preview every changed view with fixture data, verify desktop and narrow layouts, prompt composition, note navigation, splitter controls and dialogs. Check contrast and inspect the final diff.

**Validation:** All 9 Vitest suites (74 tests), `npm run typecheck`, `vite build`, and `git diff --check` passed. The local Chrome fixture run passed 38 browser checks with no unhandled page errors or unintended horizontal panel overflow. Text contrast was measured against its rendered surface colors, including status labels and selected states. Six final screenshots are available in `docs/ui-preview/`. Browser answers used a local mock; no real model service was called. Installer packaging was not run.
