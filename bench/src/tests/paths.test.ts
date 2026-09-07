import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { benchPath } from '../paths'

describe('benchPath', () => {
  it('file: URL 含百分号转义时返回解码后的真实路径', () => {
    const out = benchPath('file:///tmp/has%20space/bench/src/paths.ts', './qasper.jsonl')
    expect(out).toBe('/tmp/has space/bench/src/qasper.jsonl')
  })

  it('非 file: 协议回落到 cwd 相对路径', () => {
    const out = benchPath('http://localhost:3000/bench/src/paths.ts', '../cache/')
    expect(out).toBe(resolve(process.cwd(), 'bench', '../cache/'))
  })
})
