import { describe, it, expect } from 'vitest'
import { paragraphsToPages, normalizeQasperEntry, PSEUDO_PAGE_CHARS } from '../datasets/qasper'

describe('paragraphsToPages', () => {
  it('段落按字符数聚成伪页，并记录段落到页的映射', () => {
    const long = 'x'.repeat(PSEUDO_PAGE_CHARS)
    const { pages, paragraphToPage } = paragraphsToPages([long, long, 'short'])
    expect(pages).toHaveLength(3)
    expect(paragraphToPage).toEqual([0, 1, 2])
  })

  it('短段落合并进同一伪页', () => {
    const { pages, paragraphToPage } = paragraphsToPages(['a', 'b', 'c'])
    expect(pages).toHaveLength(1)
    expect(paragraphToPage).toEqual([0, 0, 0])
  })

  it('空段落数组产出空页列表', () => {
    const { pages, paragraphToPage } = paragraphsToPages([])
    expect(pages).toEqual([])
    expect(paragraphToPage).toEqual([])
  })

  it('单个超长段落独占一页，不被切断', () => {
    const huge = 'y'.repeat(PSEUDO_PAGE_CHARS * 3)
    const { pages } = paragraphsToPages([huge])
    expect(pages).toHaveLength(1)
    expect(pages[0].length).toBe(huge.length)
  })
})

describe('normalizeQasperEntry', () => {
  const entry = {
    title: 'Test Paper',
    abstract: 'the abstract',
    full_text: {
      section_name: ['Intro', 'Methods'],
      paragraphs: [['intro para one', 'intro para two'], ['methods para']],
    },
    qas: {
      question: ['Q1?', 'Q2?'],
      answers: [
        [{ answer: { free_form_answer: 'A1', extractive_spans: [], unanswerable: false, evidence: ['methods para'] } }],
        [{ answer: { free_form_answer: '', extractive_spans: [], unanswerable: true, evidence: [] } }],
      ],
    },
  }

  it('产出 EvalSample，source 为 qasper', () => {
    const s = normalizeQasperEntry('1234.5678', entry)
    expect(s.paperId).toBe('1234.5678')
    expect(s.title).toBe('Test Paper')
    expect(s.source).toBe('qasper')
    expect(s.referenceAbstract).toBe('the abstract')
  })

  it('把 evidence 原文反查回段落并映射到伪页', () => {
    const s = normalizeQasperEntry('p', entry)
    // 三个段落都很短，全在伪页 0
    expect(s.questions[0].evidencePages).toEqual([0])
  })

  it('保留 unanswerable 标签，且该问题 answers 为空', () => {
    const s = normalizeQasperEntry('p', entry)
    expect(s.questions[1].unanswerable).toBe(true)
    expect(s.questions[1].answers).toEqual([])
  })

  it('free_form_answer 与 extractive_spans 都收作参考答案', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'eight', extractive_spans: ['8 heads'], unanswerable: false, evidence: [] } },
        ]],
      },
    })
    expect(s.questions[0].answers).toEqual(['eight', '8 heads'])
  })

  it('多标注者的答案合并为多参考', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'eight', extractive_spans: [], unanswerable: false, evidence: [] } },
          { answer: { free_form_answer: '8', extractive_spans: [], unanswerable: false, evidence: [] } },
        ]],
      },
    })
    expect(s.questions[0].answers).toEqual(['eight', '8'])
  })

  it('evidence 匹配不上任何段落时该问题 evidencePages 为空', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'x', extractive_spans: [], unanswerable: false, evidence: ['不存在的段落'] } },
        ]],
      },
    })
    expect(s.questions[0].evidencePages).toEqual([])
  })

  it('问题 id 由 paperId 与序号组成', () => {
    const s = normalizeQasperEntry('1234.5678', entry)
    expect(s.questions[0].id).toBe('1234.5678#0')
  })
})
