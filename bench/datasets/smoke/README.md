# 冒烟集准备指南

冒烟集用真实 PDF 验证端到端链路，覆盖 QASPER 伪页无法暴露的问题：PDF 文本抽取质量、
`detectSectionBoundaries` 的节标题识别命中率、真实排版下的分块效果。

## 步骤

1. 挑 5–10 篇论文 PDF，放入 `papers/`（该目录已 git-ignored）
2. 在 `manifest.json` 的 `papers` 数组中登记每篇的 `file` / `title` / `url` / `sha256`，供他人复现；下载后执行 `shasum -a 256 papers/<file>` 核对校验和
3. 在 `annotations.json` 中为每篇写 3–5 个问题：

```json
[
  {
    "file": "attention.pdf",
    "title": "Attention Is All You Need",
    "referenceAbstract": "论文的原始 abstract 原文",
    "questions": [
      { "q": "多头注意力用了几个头？", "answer": "8", "evidencePages": [4] }
    ]
  }
]
```

## 标注约定

- `evidencePages` 写 **1-based 页码**（就是 PDF 阅读器上显示的页码），加载时自动转 0-based
- `answer` 尽量简短（词或短语），因为 `answerF1` 是 token 级 F1，长句参考答案会稀释分数
- `referenceAbstract` 直接抄论文原文 abstract，作为摘要任务的参考
- 页码写错会让评测直接报错而非静默给 0 分——这是故意的

## 最小复现清单

仓库提交了 `papers/semantic-headings.pdf`：一个可由 PDF.js 实际解析的确定性 fixture，覆盖页中标题与连续重复页眉；它的人工 QA 位于 `annotations.json`，校验和位于 `manifest.json`。版权 PDF 仍不提交：请在 `manifest.json` 记录公开来源 URL 与 SHA-256，下载到 `papers/` 后再填入 `annotations.json` 的人工 QA。报表会将此数据源标为“smoke（真实 PDF）”，与 QASPER 的“标题注入伪页”分开展示；请勿把两者混作同一分数比较。
