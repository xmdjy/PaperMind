import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { EvalSample, QaQuestion } from '../types'
import { benchPath } from '../paths'

/** 伪页大小：约等于一页学术论文的字符数。 */
export const PSEUDO_PAGE_CHARS = 3000

// DEFAULT_PATH 必须走 bench/src/paths.ts 的 benchPath（fileURLToPath），
// 不能用 new URL(...).pathname——后者保留百分号转义，路径含空格时静默失效（Task 2 I-5 的教训）
const DEFAULT_PATH = () => benchPath(import.meta.url, '../../datasets/qasper/qasper.jsonl')

/** QASPER 原始条目（HuggingFace allenai/qasper 的字段布局）。 */
export interface QasperEntry {
  title: string
  abstract: string
  full_text: {
    section_name: string[]
    paragraphs: string[][]
  }
  qas: {
    question: string[]
    answers: Array<Array<{
      answer: {
        free_form_answer: string
        extractive_spans: string[]
        unanswerable: boolean
        evidence: string[]
      }
    }>>
  }
}

/**
 * 段落按累计字符数聚成伪页。段落不切断——切断会让 evidence 跨页归属含糊。
 * 返回每个段落所属的伪页号，供 evidence 映射使用。
 */
export function paragraphsToPages(paragraphs: string[]): {
  pages: string[]
  paragraphToPage: number[]
} {
  const pages: string[] = []
  const paragraphToPage: number[] = []
  let buffer: string[] = []
  let bufferLen = 0

  for (const para of paragraphs) {
    // 当前页已有内容且加上这段会超限 → 先封页
    if (bufferLen > 0 && bufferLen + para.length > PSEUDO_PAGE_CHARS) {
      pages.push(buffer.join('\n\n'))
      buffer = []
      bufferLen = 0
    }
    paragraphToPage.push(pages.length)
    buffer.push(para)
    bufferLen += para.length
  }
  if (buffer.length > 0) pages.push(buffer.join('\n\n'))

  return { pages, paragraphToPage }
}

export function normalizeQasperEntry(paperId: string, entry: QasperEntry): EvalSample {
  const flatParagraphs = entry.full_text.paragraphs.flat()
  const { pages, paragraphToPage } = paragraphsToPages(flatParagraphs)

  // evidence 是段落原文字符串，建索引以便反查段落下标
  const paragraphIndex = new Map<string, number>()
  flatParagraphs.forEach((p, i) => {
    if (!paragraphIndex.has(p)) paragraphIndex.set(p, i)
  })

  const questions: QaQuestion[] = entry.qas.question.map((question, i) => {
    const annotations = entry.qas.answers[i] ?? []
    const unanswerable = annotations.length > 0 && annotations.every(a => a.answer.unanswerable)

    const answers: string[] = []
    const evidencePages = new Set<number>()
    for (const { answer } of annotations) {
      if (answer.unanswerable) continue
      if (answer.free_form_answer) answers.push(answer.free_form_answer)
      answers.push(...answer.extractive_spans)
      for (const ev of answer.evidence) {
        const paraIdx = paragraphIndex.get(ev)
        if (paraIdx !== undefined) evidencePages.add(paragraphToPage[paraIdx])
      }
    }

    return {
      id: `${paperId}#${i}`,
      question,
      answers,
      evidencePages: [...evidencePages].sort((a, b) => a - b),
      unanswerable,
    }
  })

  return {
    paperId,
    title: entry.title,
    pages,
    questions,
    referenceAbstract: entry.abstract,
    source: 'qasper',
  }
}

/** 加载 fetch.ts 归一化后的 jsonl（每行一个 EvalSample）。 */
export async function loadQasperDataset(path: string = DEFAULT_PATH()): Promise<EvalSample[]> {
  if (!existsSync(path)) {
    throw new Error(
      `QASPER 数据集不存在：${path}。` +
      `先运行 npx tsx bench/datasets/qasper/fetch.ts 拉取并归一化。`,
    )
  }
  const content = await readFile(path, 'utf-8')
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as EvalSample)
}
