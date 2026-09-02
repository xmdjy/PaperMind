import { describe, it, expect, vi } from 'vitest'

// Node 环境缺 DOMMatrix，pageIndex 顶层会初始化 pdfjs worker
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

describe('bench 骨架', () => {
  it('可以 import 生产管线代码', async () => {
    const { runRagPipeline, MATH_FORMAT_INSTRUCTION } = await import('../../../src/utils/ragPipeline')
    expect(typeof runRagPipeline).toBe('function')
    expect(MATH_FORMAT_INSTRUCTION).toContain('$')
  })

  it('可以 import bench 共享类型模块（编译期存在即通过）', async () => {
    const mod = await import('../types')
    expect(mod).toBeDefined()
  })
})
