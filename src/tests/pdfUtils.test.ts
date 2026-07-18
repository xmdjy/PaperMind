import { describe, it, expect, vi } from 'vitest'

// Mock pdfjs-dist before importing pdfUtils — avoids DOMMatrix error in Node/jsdom
vi.mock('pdfjs-dist', () => ({
  default: {},
  GlobalWorkerOptions: { workerSrc: '' },
}))

// Import only after mock is set up
const { base64ToUrl } = await import('../utils/pdfUtils')

describe('base64ToUrl', () => {
  it('returns a blob: URL', () => {
    const url = base64ToUrl(btoa('\x25\x50\x44\x46'))
    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url)
  })

  it('creates a Blob with application/pdf type', () => {
    let captured: Blob | undefined
    const orig = URL.createObjectURL
    URL.createObjectURL = (b: Blob) => { captured = b; return 'blob:mock' }
    base64ToUrl(btoa('test'))
    expect(captured?.type).toBe('application/pdf')
    URL.createObjectURL = orig
  })
})

// pageIndex 依赖 pdfjs-dist，在同一文件内 mock 已生效，直接动态导入
const { detectSectionBoundaries } = await import('../utils/pageIndex')

describe('detectSectionBoundaries', () => {
  it('detects English numbered headings', () => {
    const pages = [
      'Some preamble text on page 1.',
      '1. Introduction\nThis paper presents a novel approach...',
      'Continued introduction text across this page.',
      '2. Methods\nWe used the following experimental setup...',
      '3. Results\nOur experiments demonstrate significant improvements...',
    ]
    expect(detectSectionBoundaries(pages)).toEqual([1, 3, 4])
  })

  it('detects all-caps headings', () => {
    const pages = [
      'Abstract content describing the paper.',
      'INTRODUCTION\nIn this work we explore...',
      'More introduction content here.',
      'METHODS\nWe performed the following steps...',
    ]
    expect(detectSectionBoundaries(pages)).toEqual([1, 3])
  })

  it('detects common section name headings (case-insensitive)', () => {
    const pages = [
      'Abstract\nThis paper investigates...',
      'Introduction\nPrior work has shown...',
      'Conclusion\nIn summary...',
    ]
    expect(detectSectionBoundaries(pages)).toEqual([0, 1, 2])
  })

  it('detects Chinese chapter headings', () => {
    const pages = [
      '摘要内容在此处。',
      '第一章 引言\n本文研究了以下问题...',
      '1.1 研究背景\n近年来深度学习取得了巨大进展...',
      '第二章 方法\n本章详细介绍实验方法...',
    ]
    expect(detectSectionBoundaries(pages)).toEqual([1, 2, 3])
  })

  it('returns empty array when no headings found (scanned PDF)', () => {
    const pages = [
      'this is a scanned document without any clear section headings at all',
      'more unstructured text content here without patterns',
      'even more plain text with no recognizable heading format',
    ]
    expect(detectSectionBoundaries(pages)).toEqual([])
  })
})
