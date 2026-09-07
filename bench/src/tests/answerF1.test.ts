import { describe, it, expect } from 'vitest'
import { normalizeAnswer, tokenF1, answerF1, isRefusal } from '../metrics/answerF1'

describe('normalizeAnswer', () => {
  it('小写化、去冠词、去标点、压缩空白', () => {
    expect(normalizeAnswer('The  Answer, is: 8!')).toBe('answer is 8')
  })

  it('只去独立的冠词，不切词内字母', () => {
    // "a" 是冠词要去掉，但 "attention" 里的 a 不能动
    expect(normalizeAnswer('a attention head')).toBe('attention head')
  })

  it('保留中文字符', () => {
    expect(normalizeAnswer('八个注意力头。')).toBe('八个注意力头')
  })
})

describe('tokenF1', () => {
  it('完全一致时为 1', () => {
    expect(tokenF1('8 heads', 'The 8 heads')).toBe(1)
  })

  it('完全不相交时为 0', () => {
    expect(tokenF1('cats', 'dogs')).toBe(0)
  })

  it('部分重叠时按 precision/recall 调和平均', () => {
    // pred: [a,b]，ref: [b,c] → precision 0.5, recall 0.5, F1 0.5
    expect(tokenF1('alpha beta', 'beta gamma')).toBeCloseTo(0.5)
  })

  it('重复 token 按出现次数取最小值计入', () => {
    // pred: [x,x]，ref: [x] → 共同 1 个；precision 0.5, recall 1 → F1 ≈ 0.667
    expect(tokenF1('x x', 'x')).toBeCloseTo(2 / 3)
  })

  it('任一侧为空时为 0，不产生 NaN', () => {
    expect(tokenF1('', 'answer')).toBe(0)
    expect(tokenF1('answer', '')).toBe(0)
    expect(Number.isNaN(tokenF1('', ''))).toBe(false)
  })
})

describe('answerF1', () => {
  it('多参考答案取最高分', () => {
    expect(answerF1('eight heads', ['8', 'eight heads'])).toBe(1)
  })

  it('参考答案为空数组时为 0', () => {
    expect(answerF1('anything', [])).toBe(0)
  })
})

describe('isRefusal', () => {
  it('识别中文拒答表述', () => {
    expect(isRefusal('抱歉，参考内容中没有提到这一点。')).toBe(true)
    expect(isRefusal('根据提供的上下文无法回答该问题')).toBe(true)
  })

  it('识别英文拒答表述', () => {
    expect(isRefusal('The paper does not mention this.')).toBe(true)
    expect(isRefusal("I cannot answer based on the given context.")).toBe(true)
  })

  it('正常作答不算拒答', () => {
    expect(isRefusal('论文中使用了 8 个注意力头。')).toBe(false)
  })
})
