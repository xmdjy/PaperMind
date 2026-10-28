// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureManagedDoclingTunnel, stopManagedDoclingTunnel } from '../../electron/doclingTunnel'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), connect: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:net', () => ({ connect: mocks.connect }))

afterEach(() => { stopManagedDoclingTunnel(); vi.resetAllMocks() })

describe('managed Docling deployment', () => {
  it('forwards local conversion requests to the deployed server over SSH', async () => {
    let listening = false
    mocks.connect.mockImplementation(() => {
      const socket = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() })
      queueMicrotask(() => socket.emit(listening ? 'connect' : 'error', new Error('not listening')))
      return socket
    })
    mocks.spawn.mockImplementation(() => {
      listening = true
      return Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    })
    await ensureManagedDoclingTunnel('http://127.0.0.1:5001')
    expect(mocks.spawn).toHaveBeenCalledWith('ssh', expect.arrayContaining([
      '-o', 'BatchMode=yes', '-N', '-L', '127.0.0.1:5001:127.0.0.1:5001', 'ubuntu@101.76.222.224',
    ]), { stdio: ['ignore', 'ignore', 'pipe'] })
  })
})
