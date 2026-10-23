# Reading Star Map Implementation Plan

实施记录：已完成星图导航、历史恢复、悬停预览与回归验证。

**Goal:** 实现用户已确认的密集星座式 SQLite 资料导航 demo，并恢复现有阅读会话。

**Architecture:** Vue 路由承载星图，展示组件与纯函数数据/布局逻辑分离。复用 window.db 的 paper、webQa、chat API；阅读视图接收校验过的来源/会话参数。优先沿用现有类型与控制器，不扩展数据库 schema。

**Tech Stack:** Vue 3, TypeScript, Pinia, Electron IPC, existing SQLite repositories, SVG/CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-reading-star-map-design.md`

## Global Constraints

- No database schema changes, new dependencies, real-data exports, or LLM/network requests for map loading.
- Real material counts and history must come from existing IPC records. Validation fixtures stay in a separate SQLite database and are never imported into the user database.
- Keep existing reader/source-citation behavior; no claim of restoring PDF last scroll position.
- Match approved dense constellation visual, stable positions under filtering, pointer-inert decoration, keyboard-visible focus.

## Review Focus

- Empty library and IPC failure are distinguishable; retry can recover.
- Identical IDs across PDF and web sources cannot collide.
- Most recent conversation/session is selected by activity, not arbitrary array order; belongs to the clicked source.
- Deleted/stale source or route changes during async restore cannot display another source's conversation.
- Filtering, long titles and larger libraries preserve accessible targets and do not silently hide records.

---

### Task 1: Complete local reading star-map navigation

**Files:**
- Create `src/views/ReadingMapView.vue`, `src/components/ReadingStarMap.vue`, `src/utils/readingMap.ts` (split further only when justified).
- Modify `src/App.vue`, `src/router/index.ts`, `src/views/ReaderView.vue`, `src/views/WebPreviewView.vue`.
- Tests: focused `src/tests/readingMap.test.ts`, `src/tests/readingMapView.test.ts` and reader/history regression tests using existing patterns.

**Interfaces:**
- Consume existing `DbApi.paper.list`, `DbApi.webQa.listPages/listSessions`, `DbApi.chat.listConversations`, optionally highlight metadata lazily. Use source-qualified IDs and existing source types.
- Produce route `/reading-map`; PDF target `/library/:id?conversation=<validated id>`; web target `/web-preview?page=<id>` and optional `session=<id>`. A webpage may resolve its latest session on destination to avoid eager N+1 reads.
- The implementer may choose internal names/types after reading current interfaces; exported shared types must be explicit.

- [x] Write behavioral tests for source mapping and stable layout, empty/failure recovery, recent-history selection, wrong-source and stale route rejection; run targeted tests and record expected failure before implementation.
- [x] Build metadata adapter and stable layout. Do not eagerly read PDF files, web snapshots or every message body beyond existing store contracts. Keep sources with same raw IDs independent.
- [x] Build the approved star-map view with source filters, title search, focus/hover metadata, dense decorative sky, honest real counts, loading/empty/error states and refresh. Retain filter/query in route state or component memory across reader navigation. The shipped view has no sample mode.
- [x] Add application navigation and actual reader restoration. Validate requested conversation membership. Web restore must wait for history loading/layout, select the matching saved session/snapshot, and handle source-only/no-session cases. Preserve normal reader behavior without star-map query parameters and preserve existing PDF citation queries.
- [x] Run focused tests, `npm run typecheck`, and `npm test`; report failures with exact cause. Browser checks and independent review completed; installer generation is outside this feature validation.
- [x] Self-review the complete diff and report touched files, real-data behavior, test evidence, limitations and any changes to plan.
