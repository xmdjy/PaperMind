// @vitest-environment node
import { createServer, type Server } from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDoclingRequest } from '../../electron/doclingTransport'
import { readBoundedJson } from '../utils/serviceSecurity'

const dir = mkdtempSync(join(tmpdir(), 'papermind-docling-tls-'))
let key: Buffer, cert: Buffer, otherKey: Buffer, otherCert: Buffer, wrongIpCert: Buffer
const servers: Server[] = []
function certificate(name: string, ip: string) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-subj', '/CN=PaperMind test fixture', '-addext', `subjectAltName=IP:${ip}`,
    '-keyout', join(dir, name + '.key'), '-out', join(dir, name + '.pem')], { stdio: 'ignore' })
  return [readFileSync(join(dir, name + '.key')), readFileSync(join(dir, name + '.pem'))]
}
async function serve(handler: Parameters<typeof createServer>[1], tls = { key, cert }) {
  const server = createServer(tls, handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: `https://127.0.0.1:${(server.address() as { port: number }).port}` }
}
beforeAll(() => {
  ;[key, cert] = certificate('trusted', '127.0.0.1')
  ;[otherKey, otherCert] = certificate('untrusted', '127.0.0.1')
  ;[, wrongIpCert] = certificate('wrong-ip', '127.0.0.2')
}, 20_000)
afterAll(async () => {
  await Promise.all(servers.map(server => {
    server.closeAllConnections()
    return new Promise<void>(resolve => server.close(() => resolve()))
  }))
  rmSync(dir, { recursive: true, force: true })
})

describe('Docling scoped HTTPS transport', () => {
  it('uploads multipart PDF bytes and streams JSON over a verified connection', async () => {
    let uploaded = '', contentType = '', apiKey = ''
    const { origin } = await serve(async (request, response) => {
      contentType = request.headers['content-type'] || ''
      apiKey = String(request.headers['x-api-key'])
      for await (const chunk of request) uploaded += chunk.toString()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'success' }))
    })
    const request = createDoclingRequest({ origin, ca: cert.toString() })
    const body = new FormData()
    body.append('files', new Blob(['%PDF-real-upload']), 'paper.pdf')
    const response = await request(origin + '/v1/convert/file', { method: 'POST', body, headers: { 'X-Api-Key': 'fixture-key' } })
    expect(await response.json()).toEqual({ status: 'success' })
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(uploaded).toContain('filename="paper.pdf"')
    expect(uploaded).toContain('%PDF-real-upload')
    expect(apiKey).toBe('fixture-key')
  })
  it('rejects a certificate outside the dedicated trust chain', async () => {
    const { origin } = await serve((_request, response) => response.end('{}'), { key: otherKey, cert: otherCert })
    await expect(createDoclingRequest({ origin, ca: cert.toString() })(origin)).rejects.toThrow()
  })
  it('still checks the certificate IP address', async () => {
    const { origin } = await serve((_request, response) => response.end('{}'), {
      key: readFileSync(join(dir, 'wrong-ip.key')), cert: wrongIpCert,
    })
    await expect(createDoclingRequest({ origin, ca: wrongIpCert.toString() })(origin)).rejects.toThrow(/IP|altname|certificate/i)
  })
  it('does not extend campus trust to another service origin', async () => {
    const { origin } = await serve((_request, response) => response.end('{}'))
    const request = createDoclingRequest({ origin: 'https://127.0.0.1:1', ca: cert.toString() })
    await expect(request(origin)).rejects.toThrow()
  })
  it('never follows redirects or forwards the API key to their destination', async () => {
    const received: string[] = []
    const { origin } = await serve((request, response) => {
      received.push(request.url || '')
      response.writeHead(302, { Location: '/credential-sink' })
      response.end()
    })
    await expect(createDoclingRequest({ origin, ca: cert.toString() })(origin + '/openapi.json', {
      headers: { 'X-Api-Key': 'fixture-key' },
    })).rejects.toThrow(/重定向/)
    expect(received).toEqual(['/openapi.json'])
  })
  it('aborts an in-flight request before response headers', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const { origin } = await serve(() => started())
    const controller = new AbortController()
    const pending = createDoclingRequest({ origin, ca: cert.toString() })(origin, { signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow()
    await ready
    controller.abort()
    await rejected
  })
  it('aborts a response after its headers while JSON is still streaming', async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"pending":')
    })
    const controller = new AbortController()
    const response = await createDoclingRequest({ origin, ca: cert.toString() })(origin, { signal: controller.signal })
    const pending = expect(response.json()).rejects.toThrow()
    controller.abort()
    await pending
  })
  it('allows bounded JSON reading to cancel a streaming response', async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('x'.repeat(4096))
    })
    const response = await createDoclingRequest({ origin, ca: cert.toString() })(origin)
    await expect(readBoundedJson(response, 1024)).rejects.toThrow('大小上限')
  })
})
