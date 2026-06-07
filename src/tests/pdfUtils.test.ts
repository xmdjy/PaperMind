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
