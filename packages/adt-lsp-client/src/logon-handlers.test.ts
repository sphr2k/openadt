import { createServer } from 'node:net'
import { describe, expect, test } from 'bun:test'
import {
  completeHeadlessBrowserLogon,
  extractBrowserUrl,
  withDestinationClient,
  registerLogonHandlers,
  type RequestBrowserBasedLogonParams,
  type RequestLogonInputParams,
} from './logon-handlers'
import { LSP_METHOD_DESTINATIONS_REQUEST_LOGON_INPUT } from '@openadt/adt-config'

describe('extractBrowserUrl', () => {
  test('reads the logon URL from params[0].value as the VS Code extension does', () => {
    const params: RequestBrowserBasedLogonParams = {
      id: 'DEV_100',
      params: [
        {
          value: 'https://sap.example.test/sap/bc/adt/core/http/reentranceticket',
        },
      ],
    }

    expect(extractBrowserUrl(params)).toBe(
      'https://sap.example.test/sap/bc/adt/core/http/reentranceticket'
    )
  })
})

describe('withDestinationClient', () => {
  test('adds the matching SAP client and preserves an explicit client', () => {
    const store = JSON.stringify({
      destinations: [{ id: 'DEV_100', properties: { client: '200' } }],
    })
    const base =
      'https://sap.example.test/sap/bc/adt/core/http/reentranceticket?redirect-url=http%3A%2F%2Flocalhost%3A3011%2Fadt%2Fredirect'
    expect(
      new URL(withDestinationClient(base, 'DEV_100', store)).searchParams.get('sap-client')
    ).toBe('200')
    expect(
      new URL(withDestinationClient(base + '&sap-client=300', 'DEV_100', store)).searchParams.get(
        'sap-client'
      )
    ).toBe('300')
    expect(
      new URL(withDestinationClient(base, 'OTHER', store)).searchParams.has('sap-client')
    ).toBe(false)
  })
})

describe('completeHeadlessBrowserLogon', () => {
  test('sends Basic auth to SAP and delivers the local ticket callback without waiting', async () => {
    const calls: Array<{ url: string; authorization?: string }> = []
    let releaseCallback!: () => void
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve
    })
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('authorization') ?? undefined
      calls.push({ url, authorization })
      if (calls.length === 1) {
        return new Response(null, {
          status: 307,
          headers: {
            location: 'http://localhost:3011/adt/redirect?reentrance-ticket=one-time-ticket',
          },
        })
      }
      await callbackGate
      return new Response(null, { status: 302 })
    }) as unknown as typeof fetch

    const started = await completeHeadlessBrowserLogon(
      'https://sap.example.test/sap/bc/adt/core/http/reentranceticket?redirect-url=local',
      { username: 'DEVELOPER', password: 'secret' },
      undefined,
      fetchMock
    )

    expect(started).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.authorization).toBe(
      `Basic ${Buffer.from('DEVELOPER:secret').toString('base64')}`
    )
    expect(calls[1]?.url).toBe(
      'http://127.0.0.1:3011/adt/redirect?reentrance-ticket=one-time-ticket'
    )
    expect(calls[1]?.authorization).toBeUndefined()
    releaseCallback()
  })

  test('rejects a redirect outside the local ADT-LS callback', async () => {
    const fetchMock = (async () =>
      new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.example/collect' },
      })) as unknown as typeof fetch

    const started = await completeHeadlessBrowserLogon(
      'https://sap.example.test/sap/bc/adt/core/http/reentranceticket?redirect-url=local',
      { username: 'DEVELOPER', password: 'secret' },
      undefined,
      fetchMock
    )

    expect(started).toBe(false)
  })
})

describe('requestLogonInput', () => {
  test('sends sensitive fields to the supplied socket and returns only non-sensitive fields', async () => {
    const oldUsername = process.env.OPENADT_SAP_LOGON_USERNAME
    const oldPassword = process.env.OPENADT_SAP_LOGON_PASSWORD
    process.env.OPENADT_SAP_LOGON_USERNAME = 'DEVELOPER'
    process.env.OPENADT_SAP_LOGON_PASSWORD = 'secret'

    let receivedPayload = ''
    const socketServer = createServer((socket) => {
      socket.on('data', (chunk) => {
        receivedPayload += chunk.toString()
      })
    })
    await new Promise<void>((resolve) => socketServer.listen(0, '127.0.0.1', resolve))
    const address = socketServer.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP socket address')

    const handlers = new Map<string, (params: RequestLogonInputParams) => Promise<unknown>>()
    const connection = {
      onRequest: (
        method: string,
        handler: (params: RequestLogonInputParams) => Promise<unknown>
      ) => {
        handlers.set(method, handler)
      },
      onNotification: () => undefined,
      sendRequest: async () => undefined,
    }
    registerLogonHandlers(connection as never)

    try {
      const handler = handlers.get(LSP_METHOD_DESTINATIONS_REQUEST_LOGON_INPUT)
      if (!handler) throw new Error('requestLogonInput handler was not registered')
      const response = await handler({
        id: 'DEV_100',
        sensitiveFieldsSocketPort: address.port,
        params: [
          { name: 'username', sensitive: false },
          { name: 'password', sensitive: true },
        ],
      })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(response).toEqual({
        nonSensitiveFields: { username: 'DEVELOPER' },
      })
      expect(JSON.parse(receivedPayload)).toEqual({ password: 'secret' })
      expect(JSON.stringify(response)).not.toContain('secret')
    } finally {
      socketServer.close()
      if (oldUsername === undefined) delete process.env.OPENADT_SAP_LOGON_USERNAME
      else process.env.OPENADT_SAP_LOGON_USERNAME = oldUsername
      if (oldPassword === undefined) delete process.env.OPENADT_SAP_LOGON_PASSWORD
      else process.env.OPENADT_SAP_LOGON_PASSWORD = oldPassword
    }
  })
})
