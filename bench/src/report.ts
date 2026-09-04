import type { BenchResult } from './types'
import { REFUSAL_PATTERN_VERSION } from './metrics/answerF1'
import { aggregate } from './metrics/aggregate'

/** 各任务的主指标，用于在矩阵报表中标出最优行。 */
export const PRIMARY_METRIC: Record<'qa' | 'summary', string> = {
  qa: 'evidenceRecall',
  summary: 'rougeL',
}

function fmt(value: number): string {
  return Number.isInteger(value) && Math.abs(value) >= 10
    ? String(value)
    : value.toFixed(3)
}

function collectMetricNames(results: BenchResult[]): string[] {
  const names = new Set<string>()
  for (const r of results) for (const k of Object.keys(r.metrics)) names.add(k)
  return [...names].sort()
}

export function renderReport(
  results: BenchResult[],
  opts: { primaryMetric?: string } = {},
): string {
  if (results.length === 0) return '## 评测报表\n\n无结果。\n'

  const first = results[0]
  const primary = opts.primaryMetric ?? PRIMARY_METRIC[first.task]
  const metricNames = collectMetricNames(results)

  // 主指标最高的行加粗（> 严格大于，并列时取先出现的）；仅矩阵模式（多行）加粗，
  // 单结果不加粗，否则行标签变为 **name** 破坏 `| name |` 形态
  let bestIndex = -1
  let bestValue = -Infinity
  if (results.length > 1) {
    results.forEach((r, i) => {
      const v = r.metrics[primary]
      if (v !== undefined && v > bestValue) {
        bestValue = v
        bestIndex = i
      }
    })
  }

  const lines: string[] = []
  lines.push(`## 评测报表：${first.task}`)
  lines.push('')

  const sources = new Set(results.flatMap(result => result.perSample.map(record => record.source)))
  if (sources.size > 0) {
    lines.push('### 按数据来源')
    lines.push('')
    lines.push('| 配置 | 来源 | 完成 | evidenceRecall | evidenceHitRate |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const result of results) {
      for (const source of sources) {
        const records = result.perSample.filter(record => record.source === source)
        if (records.length === 0) continue
        const sourceMetrics = renameSourceRates(aggregate(records))
        lines.push(`| ${result.config.name} | ${source === 'qasper' ? 'QASPER（标题注入伪页）' : 'smoke（真实 PDF）'} | ${records.length} | ${sourceMetrics.evidenceRecall === undefined ? '—' : fmt(sourceMetrics.evidenceRecall)} | ${sourceMetrics.evidenceHitRate === undefined ? '—' : fmt(sourceMetrics.evidenceHitRate)} |`)
      }
    }
    lines.push('')
  }
  lines.push(`- 模型：\`${first.meta.model}\``)
  if (first.meta.judgeModel) lines.push(`- Judge 模型：\`${first.meta.judgeModel}\``)
  lines.push(`- 代码版本：\`${first.meta.gitSha}\``)
  lines.push(`- 时间：${first.meta.timestamp}`)
  lines.push(`- 主指标：\`${primary}\`（加粗行为最优）`)
  if (first.meta.unanswerableMethod) {
    lines.push(`- \`unanswerableAccuracy\` 判定口径：\`${first.meta.unanswerableMethod}\``)
    // 口径自证：pattern 口径下补印拒答模式表版本，judge 口径的版本已嵌 prompt，无需重复打印
    if (first.meta.unanswerableMethod === 'pattern') {
      lines.push(`- 拒答模式表版本：\`${REFUSAL_PATTERN_VERSION}\``)
    }
  }
  if (first.meta.evidenceMappingCoverage !== undefined) {
    lines.push(`- Evidence 映射覆盖率：${fmt(first.meta.evidenceMappingCoverage)}`)
    lines.push(`- Evidence 歧义率：${fmt(first.meta.ambiguousEvidenceRate ?? 0)}`)
    lines.push(`- Evidence 未映射率：${fmt(first.meta.unmappedEvidenceRate ?? 0)}`)
  }
  lines.push('')

  lines.push(`| 配置 | 完成 | ${metricNames.join(' | ')} |`)
  lines.push(`| --- | --- | ${metricNames.map(() => '---').join(' | ')} |`)
  results.forEach((r, i) => {
    const cells = metricNames.map(n => {
      const v = r.metrics[n]
      if (v === undefined) return '—'
      return i === bestIndex && n === primary ? `**${fmt(v)}**` : fmt(v)
    })
    const label = i === bestIndex ? `**${r.config.name}**` : r.config.name
    lines.push(`| ${label} | ${r.meta.completed}/${r.meta.total} | ${cells.join(' | ')} |`)
  })
  lines.push('')

  const errorLines = renderErrors(results)
  if (errorLines.length > 0) {
    lines.push('### 失败样本')
    lines.push('')
    lines.push('| 配置 | 阶段 | 次数 | 示例信息 |')
    lines.push('| --- | --- | --- | --- |')
    lines.push(...errorLines)
    lines.push('')
  }

  return lines.join('\n')
}

function renameSourceRates(metrics: Record<string, number>): Record<string, number> {
  return {
    ...metrics,
    ...(metrics.evidenceHit !== undefined ? { evidenceHitRate: metrics.evidenceHit } : {}),
  }
}

/** 失败样本按阶段聚合计数 + 一条示例信息（截断 80 字符），不逐条罗列。 */
function renderErrors(results: BenchResult[]): string[] {
  const lines: string[] = []
  for (const r of results) {
    const byStage = new Map<string, { count: number; sample: string }>()
    for (const e of r.errors) {
      const entry = byStage.get(e.stage) ?? { count: 0, sample: e.message }
      entry.count++
      byStage.set(e.stage, entry)
    }
    for (const [stage, { count, sample }] of byStage) {
      lines.push(`| ${r.config.name} | ${stage} | ${count} | ${sample.slice(0, 80)} |`)
    }
  }
  return lines
}

export function renderComparison(a: BenchResult, b: BenchResult): string {
  const names = collectMetricNames([a, b])
  const lines: string[] = []
  lines.push(`## 结果对比：${a.config.name} → ${b.config.name}`)
  lines.push('')
  lines.push(`- A：\`${a.meta.gitSha}\` @ ${a.meta.timestamp}（完成 ${a.meta.completed}/${a.meta.total}）`)
  lines.push(`- B：\`${b.meta.gitSha}\` @ ${b.meta.timestamp}（完成 ${b.meta.completed}/${b.meta.total}）`)
  lines.push('')
  lines.push('| 指标 | A | B | 差值 |')
  lines.push('| --- | --- | --- | --- |')
  for (const name of names) {
    const va = a.metrics[name]
    const vb = b.metrics[name]
    const delta = va !== undefined && vb !== undefined
      ? `${vb - va >= 0 ? '+' : ''}${fmt(vb - va)}`
      : '—'
    lines.push(`| ${name} | ${va !== undefined ? fmt(va) : '—'} | ${vb !== undefined ? fmt(vb) : '—'} | ${delta} |`)
  }
  lines.push('')
  return lines.join('\n')
}
