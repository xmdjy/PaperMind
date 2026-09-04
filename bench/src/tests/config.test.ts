import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandMatrix, loadConfigs, configLabel } from '../config'

describe('expandMatrix', () => {
  it('单点矩阵展开为一个配置', () => {
    const out = expandMatrix({ name: 'default', matrix: { topK: [2], minScore: [4] } })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'default', topK: 2, minScore: 4 })
  })

  it('多值字段展开为笛卡尔积', () => {
    const out = expandMatrix({ name: 'ab', matrix: { topK: [1, 2, 3], minScore: [4, 6] } })
    expect(out).toHaveLength(6)
    expect(out.map(c => `${c.topK}/${c.minScore}`)).toEqual([
      '1/4', '1/6', '2/4', '2/6', '3/4', '3/6',
    ])
  })

  it('展开出的每个配置带唯一 name', () => {
    const out = expandMatrix({ name: 'ab', matrix: { topK: [1, 2] } })
    expect(new Set(out.map(c => c.name)).size).toBe(2)
    expect(out[0].name).toContain('ab')
  })

  it('布尔字段正常展开', () => {
    const out = expandMatrix({ name: 'chunk', matrix: { forceFixedChunk: [true, false] } })
    expect(out.map(c => c.forceFixedChunk)).toEqual([true, false])
  })

  it('空矩阵返回单个仅含 name 的配置', () => {
    const out = expandMatrix({ name: 'bare', matrix: {} })
    expect(out).toEqual([{ name: 'bare' }])
  })
})

describe('loadConfigs', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-cfg-'))
    writeFileSync(join(dir, 'mine.json'), JSON.stringify({ name: 'mine', matrix: { topK: [1, 2] } }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('按名称从配置目录加载', async () => {
    const out = await loadConfigs('mine', dir)
    expect(out).toHaveLength(2)
  })

  it('按完整路径加载', async () => {
    const out = await loadConfigs(join(dir, 'mine.json'), dir)
    expect(out).toHaveLength(2)
  })

  it('文件不存在时抛出带路径的错误', async () => {
    await expect(loadConfigs('nope', dir)).rejects.toThrow(/nope/)
  })

  it('默认配置目录能加载内置 default 配置（防路径解析静默失效）', async () => {
    const out = await loadConfigs('default')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('default')
  })

  it('绝对路径但不以 .json 结尾时按原路径直接加载', async () => {
    // 无扩展名的绝对路径：实现按原路径使用（只要文件存在即可加载）
    writeFileSync(join(dir, 'noext'), JSON.stringify({ name: 'bare', matrix: {} }))
    const out = await loadConfigs(join(dir, 'noext'), dir)
    expect(out).toEqual([{ name: 'bare' }])
  })
})

describe('configLabel', () => {
  it('生成可读且可用作文件名的标签', () => {
    const label = configLabel({ name: 'ab', topK: 2, minScore: 4 })
    expect(label).toMatch(/^[\w.-]+$/)
    expect(label).toContain('ab')
  })

  it('剔除括号与逗号且不以点结尾', () => {
    const label = configLabel({ name: 'ab[topK=2,minScore=4]', topK: 2, minScore: 4 })
    expect(label).toMatch(/^[\w.-]+$/)
    expect(label).not.toMatch(/\.$/)
    expect(label).toContain('topK')
  })
})
