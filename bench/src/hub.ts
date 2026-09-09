/**
 * Hugging Face 下载端点（计划冻结：模型下载必须走 HF_ENDPOINT=https://hf-mirror.com）。
 * transformers.js 不读 HF_ENDPOINT 环境变量，需显式设置 env.remoteHost；
 * 统一在这里做，避免每个加载点各写一份。
 */
interface TransformersEnv {
  env: { remoteHost?: string }
}

export function applyHfEndpoint(transformers: TransformersEnv): void {
  const endpoint = process.env.HF_ENDPOINT
  if (endpoint) transformers.env.remoteHost = endpoint.replace(/\/+$/, '') + '/'
}
