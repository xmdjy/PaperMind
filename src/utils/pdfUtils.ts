import * as pdfjsLib from 'pdfjs-dist'

// Use local worker (copied to public/ by vite.config.ts) — offline-safe
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

export async function parsePdfMeta(file: File): Promise<{
  title: string; authors: string[]; abstract: string; year: number; fileData: string
}> {
  const arrayBuffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const meta = await pdf.getMetadata().catch(() => ({ info: {} }))
  const info = (meta as any).info ?? {}

  // Extract first page text for abstract heuristic
  let abstract = ''
  let year = 0
  try {
    const page = await pdf.getPage(1)
    const textContent = await page.getTextContent()
    const fullText = textContent.items.map((i: any) => i.str).join(' ')
    const abstractMatch = fullText.match(/abstract[:\s]+(.{100,600})/i)
    if (abstractMatch) abstract = abstractMatch[1].trim()
    const yearMatch = fullText.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) year = parseInt(yearMatch[0])
  } catch { /* ignore */ }

  const titleRaw = info.Title || ''
  const authorRaw = info.Author || ''
  const authors = authorRaw ? authorRaw.split(/[,;]+/).map((a: string) => a.trim()).filter(Boolean) : []

  return {
    title: titleRaw || file.name.replace(/\.pdf$/i, ''),
    authors,
    abstract,
    year,
    fileData: base64,
  }
}

export function base64ToUrl(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}
