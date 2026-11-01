import { normalizeDoclingDocument, normalizeDoclingSettings, type DoclingSettings, type ParsedDocument } from '../src/utils/doclingDocument'
import { doclingRequest } from './doclingTransport'
import { nodeSecurityErrors } from '../scripts/lib/runtime-security.mjs'
import { readBoundedJson } from '../src/utils/serviceSecurity'

type Request = typeof fetch
let activeRequests = 0
const MAX_PDF_BYTES = 64 * 1024 * 1024
async function requestJson(path: string, settings: DoclingSettings, init: RequestInit, request: Request): Promise<any> {
  if (!settings.baseUrl) throw new Error('请先在设置中填写 Docling 服务地址')
  // Do not feed remote responses into an unpatched embedded Node networking stack.
  if (request === doclingRequest) {
    const errors = nodeSecurityErrors(process.versions.node)
    if (errors.length) throw new Error(`Docling 网络请求已暂停：${errors.join('；')}`)
  }
  if (activeRequests >= 2) throw new Error('Docling 解析请求过多，请等待当前任务结束后重试')
  activeRequests++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), settings.timeoutSeconds * 1000)
  try {
    controller.signal.throwIfAborted()
    const response = await request(`${settings.baseUrl}${path}`, {
      ...init, redirect: 'error', signal: controller.signal,
      headers: { ...(settings.apiKey ? { 'X-Api-Key': settings.apiKey } : {}), ...init.headers },
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 429) throw new Error('Docling 服务器繁忙，请稍后重试')
      if (response.status === 413) throw new Error('PDF 超过服务器上传大小上限')
      if ([401, 403].includes(response.status)) throw new Error('Docling 认证失败，请检查服务 API Key')
      throw new Error(`Docling 服务请求失败（HTTP ${response.status}）`)
    }
    try { return await readBoundedJson(response, 64 * 1024 * 1024) }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error('Docling 服务未返回有效 JSON')
      throw error
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Docling 请求超时（${settings.timeoutSeconds} 秒），请检查服务或增加超时设置`)
    const code = (error as NodeJS.ErrnoException | null)?.code ?? ''
    if (code.includes('CERT') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      throw new Error('Docling 证书验证失败，请检查电脑时间、更新 PaperMind 或联系管理员更新服务证书', { cause: error })
    }
    if (error instanceof TypeError || ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(code)) {
      throw new Error('无法连接 Docling 服务，请确认已连接校园网、服务地址正确且服务器正在运行', { cause: error })
    }
    throw error
  } finally { clearTimeout(timer); activeRequests-- }
}

async function convertPdfDocument(bytes: Uint8Array, fileName: string, value: DoclingSettings, request: Request, forSummary: boolean): Promise<ParsedDocument> {
  const settings = normalizeDoclingSettings(value)
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 Docling 上传大小上限（64 MiB）')
  const body = new FormData()
  body.append('files', new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }), fileName)
  const options = {
    from_formats: 'pdf', to_formats: 'json', target_type: 'inbody', image_export_mode: 'embedded',
    include_images: 'true', images_scale: '2', do_table_structure: 'true', table_mode: 'accurate',
    do_ocr: String(settings.ocr), do_formula_enrichment: String(settings.formula),
    document_timeout: String(settings.timeoutSeconds),
    ...(forSummary ? {
      layout_preset: 'layout_heron_default', ocr_engine: 'rapidocr', ocr_preset: 'rapidocr',
      table_structure_preset: 'tableformer_v1_accurate', code_formula_preset: 'codeformulav2',
    } : {}),
  }
  for (const [key, value] of Object.entries(options)) if (value !== undefined) body.append(key, value)
  const result = await requestJson('/v1/convert/file', settings, { method: 'POST', body }, request)
  if (!['success', 'partial_success'].includes(result?.status)) throw new Error('Docling 文档解析失败，请检查服务模型配置后重试')
  if (forSummary && result.status === 'partial_success') throw new Error('Docling 仅完成部分解析，无法生成完整摘要，请检查服务模型配置后重试')
  let json = result.document?.json_content
  if (typeof json === 'string') {
    try { json = JSON.parse(json) } catch { throw new Error('Docling 文档 JSON 内容无效') }
  }
  const document = normalizeDoclingDocument(json, { preserveAllPictures: forSummary })
  if (result.status === 'partial_success') document.warnings.push('Docling 仅完成部分解析，部分内容或素材可能缺失。')
  return document
}

export async function convertPdf(bytes: Uint8Array, fileName: string, value: DoclingSettings, request: Request = doclingRequest): Promise<ParsedDocument> {
  return convertPdfDocument(bytes, fileName, value, request, false)
}

export async function convertPdfForSummary(bytes: Uint8Array, fileName: string, value: DoclingSettings, request: Request = doclingRequest): Promise<ParsedDocument> {
  return convertPdfDocument(bytes, fileName, value, request, true)
}

export async function testDoclingConnection(value: DoclingSettings, request: Request = doclingRequest): Promise<string> {
  const settings = { ...normalizeDoclingSettings(value), timeoutSeconds: 30 }
  const schema = await requestJson('/openapi.json', settings, {}, request)
  if (!schema?.paths?.['/v1/convert/file']?.post) throw new Error('服务没有 Docling /v1/convert/file 转换接口，请检查根地址')
  return 'Docling 连接成功，文档转换接口可用'
}
