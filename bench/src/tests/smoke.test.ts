import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

const { loadSmokeDataset } = await import('../datasets/smoke')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-smoke-'))
  mkdirSync(join(dir, 'papers'), { recursive: true })
  writeFileSync(join(dir, 'papers', 'a.pdf'), 'fake-pdf-bytes')
  writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
    {
      file: 'a.pdf',
      title: 'Paper A',
      referenceAbstract: 'ref abstract',
      questions: [{ q: '几个头？', answer: '8', evidencePages: [4] }],
    },
  ]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const extract = async () => ['p1', 'p2', 'p3', 'p4', 'p5']

describe('loadSmokeDataset', () => {
  it('仓库自带的真实 PDF fixture 有可执行的人工标注', async () => {
    const samples = await loadSmokeDataset(undefined, { extract })
    expect(samples).toHaveLength(1)
    expect(samples[0].paperId).toBe('semantic-headings.pdf')
    expect(samples[0].questions.map(question => question.evidencePages)).toEqual([[0], [2]])
  })
  it('加载 PDF 并挂上标注', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples).toHaveLength(1)
    expect(samples[0].title).toBe('Paper A')
    expect(samples[0].pages).toHaveLength(5)
    expect(samples[0].source).toBe('smoke')
    expect(samples[0].referenceAbstract).toBe('ref abstract')
  })

  it('把标注的 1-based 页码转为 0-based', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].evidencePages).toEqual([3])
  })

  it('冒烟集问题一律 unanswerable=false 且 answers 为单元素', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].unanswerable).toBe(false)
    expect(samples[0].questions[0].answers).toEqual(['8'])
  })

  it('问题 id 由 paperId 与序号组成，保证全局唯一', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].id).toBe('a.pdf#0')
  })

  it('标注引用的 PDF 缺失时抛出带文件名的错误', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: 'missing.pdf', questions: [] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/missing\.pdf/)
  })

  it('annotations.json 不存在时抛出可诊断的错误', async () => {
    rmSync(join(dir, 'annotations.json'))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/annotations\.json/)
  })

  it('页码超出实际页数时抛错，避免静默算成漏检', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: 'a.pdf', questions: [{ q: 'x', answer: 'y', evidencePages: [99] }] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/99/)
  })

  it('1-based 页码为 0 或负数时抛错（标注笔误）', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: 'a.pdf', questions: [{ q: 'x', answer: 'y', evidencePages: [0, -1] }] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/越界/)
  })

  it('拒绝含路径分隔符的 file 字段', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: '../escape.pdf', questions: [] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/路径分隔符/)
  })
})
