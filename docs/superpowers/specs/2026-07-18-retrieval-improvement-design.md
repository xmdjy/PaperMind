# PaperMind 检索精准度改进设计

**日期：** 2026-07-18  
**状态：** 待实现  
**涉及文件：** `src/utils/pageIndex.ts`、`src/stores/chat.ts`

---

## 背景与问题

现有 RAG 管线存在以下核心缺陷：

1. **固定5页切块** — 完全忽略论文章节结构，语义单元被随机切割
2. **贪心单节点路由** — 每次只选1个节点，跨节问题天然残缺
3. **无对话上下文路由** — 追问（"那结果呢？"）因缺上下文路由到错误章节
4. **无置信度机制** — 路由失败时静默 fallback 到第一节点

---

## 目标

在**不引入向量嵌入、不增加外部依赖**的前提下，将每次提问的 LLM 调用从2次增加到最多3次（有历史时），显著提升检索精准度。

**不在本次范围内：** 向量检索、跨论文重排序、UI 变更。

---

## 架构变更

### 改前管线

```
用户问题
  → retrieve()           [Call 1：LLM 选1个节点]
  → 注入节点全文
  → callLLM()            [Call 2：生成回答]
```

### 改后管线

```
用户问题 + 对话历史
  → rewriteQuery()       [Call 1：查询改写，无历史时跳过]
  → scoreAndSelect()     [Call 2：对所有节点打分，取 Top-2]
  → 合并 Top-2 上下文（按文档顺序）
  → callLLM()            [Call 3：生成回答]
```

**实际调用次数：**
- 首条消息（无历史）：2次（跳过查询改写）
- 追问（有历史）：3次

---

## 模块设计

### 1. 语义分块（`pageIndex.ts`）

**新函数：** `detectSectionBoundaries(pages: string[]): number[]`

返回节标题出现的页码索引列表（0-based）。

**标题识别规则（按优先级）：**

```
英文：
  /^(\d+\.?\s+)[A-Z][a-zA-Z\s]{2,}$/m      → "1. Introduction", "2 Methods"
  /^[A-Z][A-Z\s]{3,30}$/m                   → "INTRODUCTION", "RELATED WORK"
  /^(Abstract|Introduction|Methods?|Results?|Discussion|Conclusion|References)$/im

中文：
  /^第[一二三四五六七八九十\d]+[章节]/m      → "第一章"、"第3节"
  /^\d+[\.\s]+[一-龥]{2,10}$/m      → "1 引言"、"3.1 实验设置"
```

**分块逻辑：**
1. 扫描所有页面文本，收集节标题所在页码 → `boundaries`
2. 按边界切块，每块 = 一个逻辑节
3. 合并小节：不足2页的节并入**前一节**（若为第一节则并入后一节），避免碎块
4. **降级：** `boundaries.length < 2` 时，回退为固定5页切块（现有行为）

**`buildPageIndex` 改动：** 内部用 `detectSectionBoundaries` 替换固定 `CHUNK` 步长，函数签名不变，对调用方透明。

---

### 2. 查询改写（`chat.ts`）

**新函数：** `rewriteQuery(query: string, history: Message[], llmFn: LLMFn): Promise<string>`

```
Prompt：
  Based on the following conversation, rewrite the user's latest question
  as a self-contained retrieval query. Resolve pronouns, expand abbreviations,
  preserve technical terms. Return ONLY the rewritten query.

  Conversation:
  <最近3条消息，格式：role: content>

  Latest question: <query>
```

**调用条件：** `conv.messages.length >= 2`（首条消息直接跳过，节省调用）  
**降级：** LLM 返回空字符串或抛出异常时，使用原始 `query` 继续

---

### 3. 节点评分多选（`pageIndex.ts`）

**新函数：** `scoreAndSelect(root, pages, query, llm)` 替换原 `retrieve()`

**接口：**
```typescript
async function scoreAndSelect(
  root: IndexNode,
  pages: string[],
  query: string,
  llm: LLMFn
): Promise<{ context: string; sources: string[] }>
```

**评分 Prompt：**
```
Query: <query>

Sections:
[0] <title>: <summary>
[1] <title>: <summary>
...

Rate each section's relevance to the query (0-10).
Return JSON only: [{"id":0,"score":8},{"id":1,"score":2},...]
```

**选取逻辑：**
1. 解析 JSON，按 `score` 降序排列
2. 取第一名节点（必选）
3. 第二名 `score >= 4` 时纳入；否则丢弃（避免低相关噪音）
4. 将选中节点按 `startPage` 升序排列（保持文档顺序）
5. 合并页面文本，节间插入 `\n\n---\n\n` 分隔符

**降级：** JSON 解析失败 → 取 `root.nodes[0]`（与原 `retrieve` 一致）

---

## 错误处理汇总

| 步骤 | 失败场景 | 降级行为 |
|------|---------|---------|
| 语义分块 | 识别出 < 2 个边界 | 5页固定切块 |
| 小节合并 | 全文仅1节 | 直接使用该节 |
| 查询改写 | LLM 异常或空响应 | 使用原始用户问题 |
| 节点评分 | JSON 解析失败 | 取第一节点 |
| 第二节点 | score < 4 | 只用第一节点 |

所有降级均静默处理，不向用户暴露错误。

---

## 测试计划

| 文件 | 测试用例 |
|------|---------|
| `src/tests/pdfUtils.test.ts` | `detectSectionBoundaries`：英文标题识别、中文标题识别、无标题时降级为空数组 |
| `src/tests/pageIndex.test.ts`（新建）| `scoreAndSelect`：正常 JSON 返回取 Top-2、第二名 score=3 时只取1个、JSON 解析失败降级 |
| `src/tests/chat.store.test.ts` | `sendMessage`：有历史时 `rewriteQuery` 被调用1次、无历史时跳过（llmFn 调用次数校验） |

---

## 数据兼容性

- **SQLite schema 不变**，`paper_indexes` 表结构无改动
- `IndexNode` 接口不变
- 旧索引（固定切块）继续可用，语义分块仅影响新建或手动重建的索引
- 建议在 UI 中提示"重建索引可提升检索精度"（超出本次范围）

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/utils/pageIndex.ts` | 修改 | 新增 `detectSectionBoundaries`；`buildPageIndex` 使用语义分块；`retrieve` 替换为 `scoreAndSelect` |
| `src/stores/chat.ts` | 修改 | 新增 `rewriteQuery`；`sendMessage` RAG 段落插入改写调用链 |
| `src/tests/pageIndex.test.ts` | 新增 | `scoreAndSelect` 单元测试 |
| `src/tests/pdfUtils.test.ts` | 修改 | 新增 `detectSectionBoundaries` 测试用例 |
| `src/tests/chat.store.test.ts` | 修改 | 新增查询改写调用次数校验 |
