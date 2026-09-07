import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractPages } from '../../../src/utils/pageIndex'
import type { EvalSample, QaQuestion } from '../types'
import { benchPath } from '../paths'

// 惰性求值：不能用 new URL(...).pathname（百分号转义 / Vitest 改写缺陷），用共享 benchPath。
const DEFAULT_DIR = () => benchPath(import.meta.url, '../../datasets/smoke/')

export interface SmokeAnnotation {
  file: string
  title?: string
  referenceAbstract?: string
  /** evidencePages 为人工标注的 1-based 页码 */
  questions: Array<{ q: string; answer: string; evidencePages: number[] }>
}

export interface SmokeDeps {
  extract?: (base64: string) => Promise<string[]>
}

export async function loadSmokeDataset(
  dir: string = DEFAULT_DIR(),
  deps: SmokeDeps = {},
): Promise<EvalSample[]> {
  const extract = deps.extract ?? extractPages
  const annotationsPath = join(dir, 'annotations.json')

  if (!existsSync(annotationsPath)) {
    throw new Error(
      `冒烟集标注文件不存在：${annotationsPath}。` +
      `请参考 bench/datasets/smoke/README.md 准备 PDF 与标注。`,
    )
  }
  const annotations = JSON.parse(await readFile(annotationsPath, 'utf-8')) as SmokeAnnotation[]

  const samples: EvalSample[] = []
  for (const ann of annotations) {
    // file 字段必须只写文件名：含路径分隔符或 .. 会越过 papers/ 目录读到目录外文件
    if (ann.file.includes('/') || ann.file.includes('\\') || ann.file.includes('..')) {
      throw new Error(`标注的 file 字段含路径分隔符：${ann.file}（应只写文件名）`)
    }
    const pdfPath = join(dir, 'papers', ann.file)
    if (!existsSync(pdfPath)) {
      throw new Error(`标注引用的 PDF 不存在：${ann.file}（期望位于 ${join(dir, 'papers')}）`)
    }
    const base64 = (await readFile(pdfPath)).toString('base64')
    const pages = await extract(base64)

    const questions: QaQuestion[] = ann.questions.map((q, i) => {
      const evidencePages = q.evidencePages.map(p => p - 1)  // 1-based → 0-based
      for (const p of evidencePages) {
        if (p < 0 || p >= pages.length) {
          throw new Error(
            `${ann.file} 第 ${i + 1} 问的 evidencePages 含越界页码 ${p + 1}` +
            `（该 PDF 共 ${pages.length} 页）`,
          )
        }
      }
      return {
        id: `${ann.file}#${i}`,
        question: q.q,
        answers: [q.answer],
        evidencePages,
        unanswerable: false,
      }
    })

    samples.push({
      paperId: ann.file,
      title: ann.title ?? ann.file,
      pages,
      questions,
      referenceAbstract: ann.referenceAbstract,
      source: 'smoke',
    })
  }
  return samples
}
