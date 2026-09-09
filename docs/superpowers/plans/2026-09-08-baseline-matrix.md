# 2026-09-08 Strong Baseline Matrix Implementation Plan

## 0. Goal and non-goals

Implement three **new, reproducibly evaluable QA baselines** on top of the existing
`bench/` harness, then compare them with the existing classic baselines and the
production PaperMind index:

1. `pageindex-adapted` — an adapter around the upstream PageIndex project for
   hierarchical, reasoning-based tree retrieval;
2. `hybrid-rerank` — BM25 + BGE-M3 candidate fusion followed by a cross-encoder
   reranker;
3. `long-section-rag` — retrieve a structural anchor, then read one bounded,
   contiguous section/paragraph neighbourhood.

This plan does **not** change the production retrieval path under `src/`. It only
extends the benchmark harness and adds baseline configuration files. A later,
separate decision may promote a winning mechanism into PaperMind.

The existing `jaccard`, `bm25`, `cosine`, and `full-context` runs remain the
**classic baseline** group. `pageindex-adapted`, `hybrid-rerank`, and
`long-section-rag` are the **strong baseline** group.

## 1. Required pre-implementation gate: fairness and method fidelity

Do this before adding a source file or configuration. Record the result in the
implementation PR/turn summary.

### 1.1 Freeze the common evaluation contract

All three runs must use exactly the following common contract.

| Dimension | Required contract |
|---|---|
| Dataset | The same checked-in QASPER JSONL and smoke samples used by the existing harness. Run QASPER and smoke separately; never merge their aggregates. |
| Input text | Use the same `EvalSample.pages` canonical text. QASPER is title-injected pseudo-pages; smoke is extracted real-PDF page text. Do not give a new baseline an external corpus, title/abstract metadata, gold evidence, reference answer, or unexposed PDF OCR. |
| Question | The first run uses the exact original `question.question` for every baseline. No query rewrite, answer-informed expansion, manual query engineering, or per-baseline prompt wording. |
| Candidate granularity | Every candidate must expose an inclusive `startPage`/`endPage`; paragraph-level candidates are allowed, but must map to their source page span before retrieval metrics are computed. |
| Generation | Reuse the existing `LlmClient`, `DEFAULT_SYSTEM_PROMPT`, `MATH_FORMAT_INSTRUCTION`, QASPER English-answer instruction, refusal logic, and final answer model. |
| Context budget | `generationContext.maxTokens = 4096`, measured with the existing BGE-M3 tokenizer. Do not silently truncate an individual candidate; stop before adding a candidate that would exceed budget. |
| Final context count | At most five independently selected context units, unless a method's core design needs a contiguous expansion; in that case the expanded region is one unit and is still subject to the same 4096-token cap. |
| Metrics | Reuse `answerF1`, `unanswerableAccuracy`, `evidenceRecall`, `evidenceHitRate`, `contextPrecision`, `MRR`, `contextTokens`, per-paper index time, retrieval P50/P95, end-to-end P50/P95, LLM-call count, cache statistics, and error records. |
| Cost accounting | Index-time model calls, embedding/reranker initialization/build time, retrieval time, and final-generation calls must all be recorded. A baseline must not hide LLM work as a cache hit. |
| Failures | A failed index/retrieval is recorded as an error and does not receive a fabricated context. Retrieval-quality denominators keep the current mapped-evidence rules. |
| Reproducibility | Pin model names/revisions and upstream commits; store config JSON in Git. First comparison is one deterministic run (`temperature=0`); if a component is stochastic, run three fixed seeds and report mean/range. |
| Model downloads | Hugging Face / Transformers model and tokenizer downloads must use the `hf-mirror.com` mirror (`HF_ENDPOINT=https://hf-mirror.com`). Do not silently switch to a different model or revision if the mirror request fails. |
| Network proxy | GitHub clones/downloads and any other dependency download that needs a proxy must use the local proxy at `127.0.0.1:7897` (for example, `HTTP_PROXY` and `HTTPS_PROXY`). Keep proxy configuration in the execution environment, never commit it to a JSON config or source file. |

### 1.2 Freeze the comparison protocol

Use the same selected sample IDs and the same request timeout for every row.

1. Run a small smoke validation first (`--dataset smoke --limit 1`) to validate
   page-span mapping, token cap, and timing fields.
2. Run the fixed QASPER subset currently used by the repository. Do not choose a
   subset after seeing any baseline result.
3. Run smoke separately to check real-PDF/section behaviour; QASPER pseudo-page
   results cannot alone establish a structural-chunking advantage.
4. Compare retrieval metrics only on the same mapped-evidence questions. Report
   each metric's sample count alongside its value.
5. Compare MRR only after verifying every runner supplies its full ranked list
   in the same candidate/page-span semantics. If a baseline cannot do so, report
   MRR as `N/A`, not a non-comparable number.
6. Full-context remains a quality reference only; never describe it as a speed or
   retrieval competitor.

### 1.3 Method-fidelity rules

The goal is to adapt each published/open-source idea, not to create an attractive
new hybrid and give it the old name.

| Baseline | Core logic that must remain | Prohibited changes |
|---|---|---|
| PageIndex-adapted | Use the pinned upstream PageIndex hierarchical index and its LLM reasoning/tree-search retrieval path. Preserve its natural-section, vectorless retrieval semantics and cited page references. | Do not add BM25, dense retrieval, cross-encoder reranking, PaperMind summaries, or a bespoke LLM score prompt and call the result “PageIndex”. |
| Hybrid-rerank | Independently retrieve BM25 and BGE-M3 candidates; fuse their ranked lists; rerank the union using the specified cross-encoder; select reranked passages under the common budget. | Do not use LLM reranking, query rewriting, section expansion, title injection beyond the canonical dataset text, or a different answer model. |
| Long-section-RAG | Retrieve an anchor with the specified lexical retriever; expand it only through original document adjacency/section boundaries; read the bounded contiguous region. | Do not construct LLM summary trees, use a reranker, expand across unrelated sections, or use gold section/evidence IDs. |

The implementation summary must explicitly state any unavoidable adapter difference
from the upstream project and explain why it is necessary for the common contract.
If the difference changes a baseline's core algorithm, stop and ask for a decision
instead of silently proceeding.

## 2. Baseline design and parameters

### 2.1 `pageindex-adapted`: strong hierarchical retrieval baseline

**Reference.** Pin a full Git commit SHA from
[`VectifyAI/PageIndex`](https://github.com/VectifyAI/PageIndex) before
implementation. PageIndex builds a natural-section hierarchical document index and
uses an LLM to reason through that tree for vectorless retrieval. It is the direct
strong baseline for PaperMind's intended tree-index / tree-search idea. It still
has no published QASPER result, so the resulting row must be reported as a local
reproduction/adaptation, not an upstream QASPER claim.

**Mandatory reconnaissance before coding.** At the pinned SHA, inspect the
upstream API/CLI and save in the implementation summary:

- commit SHA and license;
- supported canonical-text, Markdown, and PDF input paths;
- exact tree JSON schema, node identifiers, and cited page-span fields;
- exact tree-search / retrieve API used by the pinned local SDK; and
- all upstream LLM calls and their caching behaviour.

**Adapter protocol.**

1. Create a lossless canonical-document adapter from `EvalSample.pages`. It may
   encode section headings already present in the canonical text, but must preserve
   every original page span and must not add any source content. If the pinned SDK
   cannot ingest canonical text/Markdown, use a deterministic page-preserving PDF
   wrapper and declare that adapter in the result.
2. Invoke the pinned PageIndex implementation to build its tree artifact. Do not
   replace its tree builder with PaperMind's `buildPageIndex`.
3. Invoke PageIndex's documented local tree-search/retrieval interface using the
   original question and no conversation history. Preserve its model-driven branch
   decisions, node/page selection, and any documented stopping logic.
4. Return PageIndex's ranked/retrieved nodes, selected raw source text, and their
   original page spans to the shared QA measurement path. The shared final answer
   generator receives that text under the common prompt/budget contract; this
   isolates PageIndex retrieval from answer-model differences.
5. Record all PageIndex index/search model calls and every tree-search step. The
   final answer reads raw node/section text, never only a node summary.

**Hard stop.** If the pinned project has no usable local tree-search/retrieval API
that exposes the selected source pages/nodes, do not implement a fake PageIndex
baseline. Deliver the reconnaissance and request a choice between (a) evaluating
the upstream end-to-end `PageIndexClient.chat` path as a separately labelled
end-to-end baseline, or (b) dropping PageIndex from the common QA comparison.
Do not substitute flat BM25/dense retrieval and still call the result PageIndex.

**Classic configuration target.** Raw-text/context cap remains 4096. Upstream
LLM/index settings must be explicitly serialized or the run refused; no implicit
environment-default model is allowed. The initial config is named
`pageindex-adapted.json`.

### 2.2 `hybrid-rerank`: strong practical retrieval baseline

This baseline is intentionally a flat passage pipeline. It tests whether a mature
retrieval stack beats the production LLM summary-tree selector.

1. Split canonical pages with the existing BGE-M3 tokenizer into 512-token
   passages with 128-token overlap. Keep every passage's page span.
2. Build BM25 with `k1=1.2`, `b=0.75`; retrieve top 20.
3. Build BGE-M3 cosine retrieval using `BAAI/bge-m3`, revision `main`, L2
   normalized embeddings; retrieve top 20.
4. Fuse the two rankings by reciprocal-rank fusion, `k=60`; deduplicate by
   passage ID. RRF is a deterministic fusion rule and preserves both retrievers'
   candidate contribution.
5. Rerank the fused top 40 with `BAAI/bge-reranker-v2-m3`; select up to five
   reranked passages under 4096 BGE-M3 tokens.
6. Supply the full fused-and-reranked list to metric code so MRR is meaningful;
   document whether MRR is computed on the final reranked ordering (it should be).

All model downloads/cold-start time are separately observable in per-paper index
time. Query-time reranker inference belongs in retrieval latency.

Initial config name: `hybrid-rerank.json`.

### 2.3 `long-section-rag`: structural reading baseline

This is a controlled locate-then-read baseline inspired by long-unit and
structure-aware reading work, not a summary-tree system.

1. Derive deterministic section boundaries from headings already in the canonical
   text. Reuse `detectSectionBoundaries` only if it can receive the canonical
   pages and return every original page span without an LLM call. Otherwise add a
   benchmark-local deterministic heading/paragraph boundary adapter and test it.
2. Form 512-token anchor passages with 128-token overlap; build BM25 with
   `k1=1.2`, `b=0.75`; retrieve top 10 anchors.
3. Take the highest-ranked anchor. Its allowed reading region is the contiguous
   text in its containing section, centered on the anchor. Grow left/right in
   document order until 4096 tokens; never cross a section boundary. If the whole
   section is shorter than the cap, read the whole section.
4. If the best anchor's section cannot fit/resolve, use the next ranked anchor;
   record this deterministic fallback. Do not combine independent sections.
5. Treat this contiguous region as one selected context unit with the anchor's
   rank; retain the full anchor ranking for MRR and map the region to all covered
   pages for recall/precision.

Initial config name: `long-section-rag.json`.

## 3. Benchmark-harness implementation plan

### Phase A — extend types, configuration validation, and report metadata

1. Extend `bench/src/types.ts` so `BenchConfig` has explicit discriminated
   config types for `hybrid-rerank`, `long-section-rag`, and `pageindex-adapted`.
   Do not overload `TraditionalRagConfig` until its `retrieval.algorithm` union
   becomes unwieldy.
2. Extend `BenchResult.meta.retrievalAlgorithm` with explicit values such as
   `hybrid-rerank`, `long-section-rag`, and `pageindex-adapted`.
3. Extend `bench/src/config.ts` with strict runtime validators. Reject unknown
   models, impossible `topK` relationships, invalid overlap, missing upstream
   SHA, missing adapter mode, or a context cap different from 4096.
4. Update `bench/src/report.ts` to show baseline family, upstream commit (for
   PageIndex), candidate/context granularity, and metric sample counts.

### Phase B — shared passage and metrics primitives

1. Reuse `BenchChunk`, `PageSpan`, `expandPages`, `selectContext`, and
   `computeRetrievalMetrics` where their semantics already fit.
2. Add benchmark-local helpers only for deterministic RRF fusion, section-boundary
   resolution, contiguous expansion, and cross-encoder reranking. Keep them under
   `bench/src/`, not `src/utils/`.
3. Ensure every new returned candidate carries raw source text and an inclusive
   original page span. Add assertions that no selected context exceeds 4096 tokens.
4. Preserve the current evidence-mapping exclusion rules and report context token
   count for both answerable and unanswerable cases.

### Phase C — `hybrid-rerank` runner

1. Add a reusable BGE reranker provider with its model/revision stored in the
   configuration and model cache under `bench/cache/models/`.
2. Implement BM25/dense candidate build, RRF fusion, reranking, context selection,
   and normal answer generation in a dedicated runner.
3. Record BM25/dense/rerank failures with a specific `retrieve` error message;
   never silently fall back to a different retriever.
4. Add unit tests for RRF deduplication/order, reranker cut-off, page-span
   propagation, token-budget stop, and full-ranking MRR.

### Phase D — `long-section-rag` runner

1. Implement and test deterministic section/paragraph boundary extraction against
   synthetic pages including a preamble, multiple headings, a heading-like false
   positive, and a final section.
2. Implement BM25 anchor ranking and centered contiguous growth bounded by
   section and token cap.
3. Add tests proving that expansion cannot cross a section, cannot exceed 4096
   tokens, and maps all covered pages to retrieval metrics.

### Phase E — `pageindex-adapted` runner

1. Complete the Section 2.1 reconnaissance and pin the upstream source before adding
   a dependency. Prefer an adapter process boundary or a small Python bridge so
   Python dependencies do not leak into Electron/production dependencies.
2. Add a versioned adapter input/output schema containing: canonical document,
   `paperId`, page spans, tree artifact path, ranked node IDs, raw selected text,
   timing, index/search LLM-call count, search-step count, and adapter mode.
3. Build once per paper, query once per question, and cache only versioned
   artifacts keyed by paper content hash + upstream SHA + model settings. A cache
   key mismatch is a miss.
4. Convert the returned nodes to shared page spans and run the same generation and
   metric code as every other baseline.
5. Add fixture tests using a checked-in synthetic PageIndex-like tree artifact. Tests
   must not require network access or a real LLM.

### Phase F — configs, docs, and verification

Add exactly these files under `bench/configs/`:

| File | Required baseline | Initial essential parameters |
|---|---|---|
| `pageindex-adapted.json` | pinned PageIndex tree-search adapter | upstream git SHA, local adapter mode, index/chat model revisions, retrieval node topK 10, context topK 5, maxTokens 4096 |
| `hybrid-rerank.json` | hybrid RRF + cross encoder | chunk 512/128; BM25 topK 20/k1 1.2/b .75; BGE-M3 topK 20; RRF k 60/topK 40; `BAAI/bge-reranker-v2-m3`; context topK 5/maxTokens 4096 |
| `long-section-rag.json` | BM25 anchor + contiguous section read | anchors 512/128; BM25 topK 10/k1 1.2/b .75; one contiguous region; maxTokens 4096 |

Update `bench/README.md` with commands for each baseline and an explicit note
that PageIndex is an adapted external tree-retrieval baseline, not a published
QASPER QA claim. Add a short environment note specifying `HF_ENDPOINT=https://hf-mirror.com`
for Hugging Face downloads and the local `127.0.0.1:7897` proxy requirement for
GitHub/other dependency downloads; no proxy URL belongs in committed configs.

Run at minimum:

```bash
npm test -- bench/src/tests
npm run typecheck
npm run bench -- --task qa --dataset smoke --limit 1 --config hybrid-rerank
npm run bench -- --task qa --dataset smoke --limit 1 --config long-section-rag
npm run bench -- --task qa --dataset smoke --limit 1 --config pageindex-adapted
```

Then run each successful baseline against the identical fixed QASPER set, generate
the normal report, and confirm all three rows expose the agreed metric fields.

## 4. Completion / handoff checklist

The implementation is complete only if its final report explicitly contains all of
the following:

1. **Fairness declaration:** exact dataset revision/sample selection, original-query
   policy, answer model/prompt, 4096-token budget, candidate/page-span mapping,
   cache mode, timeout, and metrics policy.
2. **Method-fidelity declaration:** upstream PageIndex URL + pinned SHA, its
   local tree-search adapter mode and every unavoidable divergence; exact RRF/reranker parameters;
   exact long-section boundary and expansion rules. State that no prohibited core
   logic was added. If a divergence was necessary, state it prominently.
3. **Configuration declaration:** list all three committed JSON files and their
   model revisions. No secrets, local absolute paths, or unpinned environment
   defaults may appear in a config.
4. **Network/dependency declaration:** state that Hugging Face models were
   fetched through `HF_ENDPOINT=https://hf-mirror.com`, and state whether GitHub
   or other downloads used the local `127.0.0.1:7897` proxy. Do not include proxy
   credentials or persist proxy settings in repository files.
5. **Verification declaration:** commands run, pass/fail results, dataset sizes,
   errors, and whether every metric is comparable. State `N/A` for unsupported
   MRR rather than implying comparability.
6. **Implementation map:** concise list of each new/changed core runner, adapter,
   retrieval primitive, config validator, metrics/reporting file, tests, and docs.
   This is required so a different agent can audit the change without rediscovering
   the architecture.
7. **Result interpretation boundary:** do not claim a winner solely from answer
   F1. Discuss evidence recall, hit rate, context precision, MRR comparability,
   context tokens, index cost, retrieval P50/P95, end-to-end P50/P95, and LLM
   calls together.

## 5. Expected output matrix

The report must show, at minimum:

| Group | Rows |
|---|---|
| Classic | Full-context, Jaccard, BM25, cosine/BGE-M3 |
| Strong | PageIndex-adapted, Hybrid-rerank, Long-section-RAG |
| Primary method | PaperMind current |

No row is allowed to be renamed to conceal a method change. In particular,
`pageindex+bm25` (if separately approved) must be reported as an explicit hybrid
ablation, separate from `pageindex-adapted`.
