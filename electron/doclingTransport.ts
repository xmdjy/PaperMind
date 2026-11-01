import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { DOCLING_CAMPUS_URL } from '../src/utils/doclingDocument'
import campusTrust from './certificates/docling-campus-ca.json'

interface DoclingTrust { origin: string; ca: string }

/** Dedicated trust is scoped to one origin; other services keep the platform trust store. */
export function createDoclingRequest(trust: DoclingTrust = { origin: DOCLING_CAMPUS_URL, ca: campusTrust.ca }): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== trust.origin) return fetch(input, { ...init, redirect: 'error' })
    const encoded = new Request(input, { ...init, redirect: 'error' })
    encoded.signal.throwIfAborted()
    const headers: Record<string, string> = {}
    encoded.headers.forEach((value, name) => { headers[name] = value })
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpsRequest(url, {
        method: encoded.method,
        headers,
        ca: trust.ca,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        signal: encoded.signal,
      }, incoming => {
        const status = incoming.statusCode || 502
        if (status >= 300 && status < 400) {
          incoming.destroy()
          reject(new Error('Docling 服务不允许重定向，请填写最终 HTTPS 地址'))
          return
        }
        const headers = new Headers()
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1])
        const empty = encoded.method === 'HEAD' || [204, 205, 304].includes(status)
        if (empty) incoming.resume()
        resolve(new Response(empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
          status, statusText: incoming.statusMessage, headers,
        }))
      })
      outgoing.once('error', reject)
      if (encoded.body) {
        const upload = Readable.fromWeb(encoded.body as import('node:stream/web').ReadableStream)
        upload.once('error', error => outgoing.destroy(error))
        outgoing.once('error', () => upload.destroy())
        outgoing.once('close', () => upload.destroy())
        upload.pipe(outgoing)
      } else outgoing.end()
    })
  }
}

export const doclingRequest = createDoclingRequest()
