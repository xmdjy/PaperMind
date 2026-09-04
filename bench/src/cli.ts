/**
 * Benchmark CLI——所有模块的最终汇合点：
 * 参数解析 → 配置加载 → 数据集加载 → QA/摘要 Runner → 结果落盘 → 报表渲染。
 * 通过 `npm run bench -- <args>` 执行（tsx 直跑 ESM）。
 * `--compare` 是独立路径：只读两份结果文件输出差异表，不跑评测。
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { parseArgs } from './args'
import { loadConfigs, configLabel } from './config'
import { createLlmClient, resolveEnvConfig } from './llmClient'
import { loadQasperDataset } from './datasets/qasper'
import { loadSmokeDataset } from './datasets/smoke'
import { runQaTask, DEFAULT_SYSTEM_PROMPT } from './runner/qa'
import { runSummaryTask } from './runner/summary'
import { renderReport, renderComparison } from './report'
import { benchPath } from './paths'
import type { BenchResult, EvalSample, SampleSource } from './types'

// 必须用 benchPath（fileURLToPath），不能用 new URL(...).pathname——
// 后者保留百分号转义，路径含空格/中文时得到字面量 %20 目录，写文件静默失败
const RESULTS_DIR = () => benchPath(import.meta.url, '../results/')

/** QASPER 参考答案是英文而生产 prompt 是中文，不强制英文作答则 answerF1 恒≈0（Task 10 裁定 3） */
const QASPER_LANGUAGE_INSTRUCTION = '请依据参考内容，用论文原文语言（英文）作答。'

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

async function loadDatasets(which: string): Promise<EvalSample[]> {
  const out: EvalSample[] = []
  if (which === 'qasper' || which === 'all') out.push(...await loadQasperDataset())
  if (which === 'smoke' || which === 'all') out.push(...await loadSmokeDataset())
  if (out.length === 0) {
    throw new Error(
      `数据集为空（--dataset ${which}）。QASPER 需先运行 ` +
      `npx tsx bench/datasets/qasper/fetch.ts；冒烟集见 bench/datasets/smoke/README.md`,
    )
  }
  return out
}

/** 按数据来源分组，保持原有出现顺序。 */
function groupBySource(samples: EvalSample[]): Array<[SampleSource, EvalSample[]]> {
  const map = new Map<SampleSource, EvalSample[]>()
  for (const s of samples) {
    const group = map.get(s.source) ?? []
    group.push(s)
    map.set(s.source, group)
  }
  return [...map.entries()]
}

const args = parseArgs(process.argv.slice(2))

// --compare 是独立路径：只读两份结果输出差异表，不跑评测
if (args.compare) {
  const [pathA, pathB] = args.compare
  const a = JSON.parse(readFileSync(pathA, 'utf-8')) as BenchResult
  const b = JSON.parse(readFileSync(pathB, 'utf-8')) as BenchResult
  process.stdout.write(renderComparison(a, b))
  process.exit(0)
}

// --judge 的前置校验：judge 客户端在 Task 14 接入，当前 flag 只做环境检查
// TODO(Task 14): 在此创建 judge 客户端（createLlmClient({ model: process.env.BENCH_JUDGE_MODEL })）
//   并传入 runQaTask，meta.judgeModel / unanswerableMethod 同步接线
if (args.judge && !process.env.BENCH_JUDGE_MODEL) {
  throw new Error('使用 --judge 需设置环境变量 BENCH_JUDGE_MODEL（judge 用的 LLM 模型名）')
}

const sha = gitSha()
const configs = await loadConfigs(args.config)
const samples = await loadDatasets(args.dataset)
mkdirSync(RESULTS_DIR(), { recursive: true })

// 缓存目录在 createLlmClient 内部决定（bench/cache/），CLI 层打印解析结果并检查可写性，
// 不阻塞——缓存只是加速手段，写失败会在 llmClient 内以警告形式降级
const cacheDir = benchPath(import.meta.url, '../cache/')
try {
  accessSync(dirname(cacheDir), constants.W_OK)
} catch {
  process.stdout.write(`警告：缓存目录父目录不可写（${dirname(cacheDir)}），缓存将无法写入\n`)
}
process.stdout.write(`缓存目录：${cacheDir}\n`)

process.stdout.write(
  `配置 ${configs.length} 组，样本 ${samples.length} 篇论文，代码版本 ${sha}\n`,
)

const qaResults: BenchResult[] = []
const summaryResults: BenchResult[] = []

/**
 * 结果文件名。--dataset all 时 QA 结果按来源分组各写一份，带 source 后缀防混淆；
 * --out 显式指定时追加后缀（同名会互相覆盖），单一来源时不加后缀保持简报语义。
 */
function writeResult(result: BenchResult, fileTag = '') {
  const stamp = result.meta.timestamp.replace(/[:.]/g, '-')
  let path: string
  if (args.out) {
    path = fileTag ? args.out.replace(/\.json$/i, '') + `-${fileTag}.json` : args.out
  } else {
    const tag = fileTag ? `-${fileTag}` : ''
    path = join(RESULTS_DIR(), `${result.task}${tag}-${configLabel(result.config)}-${stamp}.json`)
  }
  writeFileSync(path, JSON.stringify(result, null, 2))
  process.stdout.write(`  结果已写入 ${path}\n`)
}

for (const config of configs) {
  if (args.task === 'qa' || args.task === 'all') {
    // answerLanguageInstruction 是 runQaTask 的整轮级参数，--dataset all 混合两种来源
    // 时无法一次传入，故按 source 分组各跑一次、结果分别落盘（文件名带 source 后缀）
    for (const [source, group] of groupBySource(samples)) {
      const env = resolveEnvConfig(process.env)
      const client = createLlmClient({ ...env, useCache: args.useCache })

      process.stdout.write(`\n[QA] ${config.name}（${source}，${group.length} 篇）...\n`)
      const result = await runQaTask({
        samples: group,
        config,
        client,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        ...(source === 'qasper' ? { answerLanguageInstruction: QASPER_LANGUAGE_INSTRUCTION } : {}),
        limit: args.limit,
        gitSha: sha,
        model: env.model,
      })
      // --no-cache 当前只跳过读缓存，不覆写已有缓存文件（llmClient 待后续优化），如实记录口径
      result.meta.cacheMode = args.useCache ? 'normal' : 'bypass'

      const { hits, misses } = client.stats()
      process.stdout.write(
        `  完成 ${result.meta.completed}/${result.meta.total}，` +
        `缓存命中 ${hits}/${hits + misses}，失败 ${result.errors.length}\n`,
      )
      qaResults.push(result)
      writeResult(result, args.dataset === 'all' ? source : '')
    }
  }

  if (args.task === 'summary' || args.task === 'all') {
    process.stdout.write(`\n[摘要] ${config.name}...\n`)
    const result = await runSummaryTask({
      samples,
      config,
      hfToken: process.env.HF_TOKEN ?? '',
      limit: args.limit,
      gitSha: sha,
      model: process.env.HF_MODEL ?? 'Bashaarat1/t5-small-arxiv-summarizer',
    })
    result.meta.cacheMode = args.useCache ? 'normal' : 'bypass'
    process.stdout.write(
      `  完成 ${result.meta.completed}/${result.meta.total}，失败 ${result.errors.length}\n`,
    )
    summaryResults.push(result)
    writeResult(result)
  }
}

process.stdout.write('\n')
if (qaResults.length > 0) process.stdout.write(renderReport(qaResults) + '\n')
if (summaryResults.length > 0) process.stdout.write(renderReport(summaryResults) + '\n')
