export interface BenchArgs {
  task: 'qa' | 'summary' | 'all'
  dataset: 'qasper' | 'smoke' | 'all'
  config: string
  limit?: number
  judge: boolean
  useCache: boolean
  out?: string
  compare?: [string, string]
}

const TASKS = ['qa', 'summary', 'all'] as const
const DATASETS = ['qasper', 'smoke', 'all'] as const

/**
 * 解析 CLI 参数为强类型 BenchArgs。
 * 任何非法取值立即抛错而不是回落默认值——拼错的 flag 静默生效
 * 会让评测结果看起来正常实则跑错配置，比直接失败危害大得多。
 */
export function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    task: 'all',
    dataset: 'all',
    config: 'default',
    judge: false,
    useCache: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--task': {
        const v = argv[++i]
        if (!TASKS.includes(v as never)) {
          throw new Error(`--task 取值非法：${v}（合法值：qa / summary / all）`)
        }
        args.task = v as BenchArgs['task']
        break
      }
      case '--dataset': {
        const v = argv[++i]
        if (!DATASETS.includes(v as never)) {
          throw new Error(`--dataset 取值非法：${v}（合法值：qasper / smoke / all）`)
        }
        args.dataset = v as BenchArgs['dataset']
        break
      }
      case '--config':
        args.config = argv[++i]
        break
      case '--limit': {
        const v = Number(argv[++i])
        if (!Number.isInteger(v) || v <= 0) {
          throw new Error(`--limit 需要正整数，收到：${argv[i]}`)
        }
        args.limit = v
        break
      }
      case '--out':
        args.out = argv[++i]
        break
      case '--judge':
        args.judge = true
        break
      case '--no-cache':
        args.useCache = false
        break
      case '--compare': {
        const a = argv[++i]
        const b = argv[++i]
        if (!a || !b) throw new Error('--compare 需要两个结果文件路径')
        args.compare = [a, b]
        break
      }
      default:
        throw new Error(`未知参数：${flag}`)
    }
  }
  return args
}
