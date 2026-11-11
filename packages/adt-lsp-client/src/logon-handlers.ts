import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createConnection } from 'node:net'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MessageConnection } from '@openadt/adt-infra'
import type { McpLog } from '@openadt/adt-infra'
import {
  LSP_METHOD_DESTINATIONS_LOGON_STATE_CHANGED,
  LSP_METHOD_DESTINATIONS_REQUEST_BROWSER_LOGON,
  LSP_METHOD_DESTINATIONS_REQUEST_LOGON_INPUT,
  LSP_METHOD_DESTINATIONS_STOP_LOGON,
} from '@openadt/adt-config'

export type RequestBrowserBasedLogonParams = {
  id: string
  title?: string
  params?: Array<{ value?: string }>
}

export type RequestLogonInputParams = {
  id: string
  title?: string
  sensitiveFieldsSocketPort?: number
  params?: Array<{
    name?: string
    description?: string
    label?: string
    sensitive?: boolean
  }>
}

export type LogonStateChangedParams = {
  destinationId: string
  logonState: string
  server?: string
  user?: string
  message?: string
}

let lastLogonFailureMessage: string | undefined

function loadLogonCredentials(): { username?: string; password?: string } {
  const username = process.env.OPENADT_SAP_LOGON_USERNAME?.trim()
  const password = process.env.OPENADT_SAP_LOGON_PASSWORD
  if (username && password) return { username, password }
  const file = process.env.OPENADT_SAP_CREDENTIALS_FILE
  if (!file) return { username, password }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { user?: unknown; password?: unknown }
    if (
      typeof data.user !== 'string' ||
      !data.user.trim() ||
      typeof data.password !== 'string' ||
      !data.password
    ) {
      throw new Error('Invalid credentials')
    }
    return { username: data.user.trim(), password: data.password }
  } catch {
    throw new Error('Cannot load configured SAP credential file (expected user and password)')
  }
}

export function extractBrowserUrl(params: RequestBrowserBasedLogonParams): string | undefined {
  return params.params?.[0]?.value
}

export function withDestinationClient(url: string, destinationId: string, store: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('sap-client')) return url
    const data = JSON.parse(store) as {
      destinations?: Array<{ id?: string; properties?: { client?: string } }>
    }
    const client = data.destinations?.find((destination) => destination.id === destinationId)
      ?.properties?.client
    if (!client || !/^\d{3}$/.test(client)) return url
    parsed.searchParams.set('sap-client', client)
    return parsed.toString()
  } catch {
    return url
  }
}

function addDestinationClient(url: string, destinationId: string, storePath?: string): string {
  try {
    const dir = storePath || process.env.ADTLS_HOME || join(homedir(), '.adtls')
    return withDestinationClient(
      url,
      destinationId,
      readFileSync(join(dir, 'destinations.json'), 'utf8')
    )
  } catch {
    return url
  }
}

async function handleBrowserLogonRequest(
  connection: MessageConnection,
  params: RequestBrowserBasedLogonParams,
  log: McpLog | undefined,
  destinationsStorePath?: string
): Promise<boolean> {
  const url = extractBrowserUrl(params)
  if (!isHttpUrl(url)) {
    log?.warn(
      url ? `requestBrowserBasedLogon: invalid URL ${url}` : 'requestBrowserBasedLogon: missing URL'
    )
    return false
  }
  const { username, password } = loadLogonCredentials()
  if (username && password) {
    log?.info('SAP logon: completing reentrance-ticket flow headlessly')
    return completeHeadlessBrowserLogon(
      addDestinationClient(url, params.id, destinationsStorePath),
      { username, password },
      log
    )
  }
  log?.info(`SAP logon: opening browser (${params.title ?? params.id})`)
  console.error('[openadt-mcp] SAP logon: opening browser — complete sign-in if prompted.')
  openDefaultBrowser(url)
  return true
}

export async function completeHeadlessBrowserLogon(
  logonUrl: string,
  credentials: { username: string; password: string },
  log?: McpLog,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  let parsedLogonUrl: URL
  try {
    parsedLogonUrl = new URL(logonUrl)
  } catch {
    log?.warn('Headless SAP logon failed: invalid logon URL')
    return false
  }
  if (
    parsedLogonUrl.protocol !== 'https:' ||
    parsedLogonUrl.pathname !== '/sap/bc/adt/core/http/reentranceticket'
  ) {
    log?.warn('Headless SAP logon failed: unexpected reentrance-ticket URL')
    return false
  }

  try {
    const authorization =
      'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
    const response = await fetchImpl(logonUrl, {
      headers: { authorization },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel()

    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      log?.warn(`Headless SAP logon failed: ticket endpoint returned HTTP ${response.status}`)
      return false
    }

    const callbackUrl = new URL(location, logonUrl)
    const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(callbackUrl.hostname)
    if (
      callbackUrl.protocol !== 'http:' ||
      !isLocalHost ||
      callbackUrl.pathname !== '/adt/redirect'
    ) {
      log?.warn('Headless SAP logon failed: redirect is not the local ADT-LS callback')
      return false
    }
    if (callbackUrl.hostname === 'localhost') {
      callbackUrl.hostname = '127.0.0.1'
    }

    // The ADT-LS callback waits for this request handler to return true.
    // Start ticket delivery without awaiting the callback response.
    void fetchImpl(callbackUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
      .then((callbackResponse) => callbackResponse.body?.cancel())
      .catch((err: unknown) => {
        log?.warn(
          `Headless SAP logon callback failed: ${err instanceof Error ? err.name : 'unknown error'}`
        )
      })
    return true
  } catch (err) {
    log?.warn(`Headless SAP logon failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return false
  }
}

function isHttpUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function handleLogonInputRequest(
  connection: MessageConnection,
  params: RequestLogonInputParams,
  log: McpLog | undefined
): Promise<{ nonSensitiveFields: Record<string, string> } | undefined> {
  const nonSensitiveFields: Record<string, string> = {}
  const sensitiveFields: Record<string, string> = {}
  const { username, password } = loadLogonCredentials()

  for (const field of params.params ?? []) {
    if (!field.name) {
      log?.warn('requestLogonInput: field has no name')
      await cancelLogonInput(connection, params.id)
      return undefined
    }
    const normalizedName = field.name.toLowerCase()
    const value = ['user', 'username', 'login'].includes(normalizedName)
      ? username
      : normalizedName === 'password'
        ? password
        : undefined
    if (!value) {
      log?.warn(`requestLogonInput: no configured value for field ${field.name}`)
      await cancelLogonInput(connection, params.id)
      return undefined
    }
    if (field.sensitive) sensitiveFields[field.name] = value
    else nonSensitiveFields[field.name] = value
  }

  if (Object.keys(sensitiveFields).length > 0) {
    const port = params.sensitiveFieldsSocketPort
    if (!Number.isInteger(port) || port! < 1 || port! > 65_535) {
      log?.warn('requestLogonInput: missing or invalid sensitive-fields socket port')
      await cancelLogonInput(connection, params.id)
      return undefined
    }
    try {
      await sendSensitiveFields(port!, sensitiveFields)
    } catch (err) {
      log?.warn(
        `requestLogonInput: sensitive-fields socket failed (${err instanceof Error ? err.name : 'unknown error'})`
      )
      await cancelLogonInput(connection, params.id)
      return undefined
    }
  }

  log?.info(`SAP logon: supplied configured input fields (${params.title ?? params.id})`)
  return { nonSensitiveFields }
}

async function cancelLogonInput(
  connection: MessageConnection,
  destinationId: string
): Promise<void> {
  await connection.sendRequest(LSP_METHOD_DESTINATIONS_STOP_LOGON, {
    destinationId,
    cancel: true,
  })
}

function sendSensitiveFields(port: number, fields: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(5_000)
    socket.once('connect', () => socket.end(JSON.stringify(fields)))
    socket.once('finish', resolve)
    socket.once('timeout', () => socket.destroy(new Error('socket timeout')))
    socket.once('error', reject)
  })
}

function handleShowMessage(
  params: { message?: string; type?: number },
  log: McpLog | undefined
): undefined {
  const text = params.message ?? ''
  log?.info(`SAP message: ${text}`)
  console.error(`[openadt-mcp] SAP: ${text}`)
  return undefined
}

function handleWorkspaceConfiguration(params: { items?: Array<{ section?: string }> }): null[] {
  const count = params.items?.length ?? 0
  return Array.from({ length: count }, () => null)
}

function handleLogonStateChanged(params: LogonStateChangedParams, log: McpLog | undefined): void {
  log?.info(
    `logon ${params.destinationId}: ${params.logonState}` +
      (params.message ? ` — ${params.message}` : '')
  )
  if (params.logonState === 'pending') {
    console.error(
      `[openadt-mcp] Logon pending for ${params.destinationId} — complete SSO or Secure Login if a window opened.`
    )
    return
  }
  if (params.logonState === 'disconnected' || params.logonState === 'cancelled') {
    lastLogonFailureMessage = params.message
  }
}

/** Register SAP server→client logon handlers (same contract as VS Code extension). */
export function registerLogonHandlers(
  connection: MessageConnection,
  log?: McpLog,
  destinationsStorePath?: string
): void {
  connection.onRequest(LSP_METHOD_DESTINATIONS_REQUEST_BROWSER_LOGON, (params) =>
    handleBrowserLogonRequest(connection, params, log, destinationsStorePath)
  )
  connection.onRequest(LSP_METHOD_DESTINATIONS_REQUEST_LOGON_INPUT, (params) =>
    handleLogonInputRequest(connection, params, log)
  )
  connection.onRequest('window/showMessage', (params) => handleShowMessage(params, log))
  connection.onRequest('workspace/configuration', handleWorkspaceConfiguration)
  connection.onNotification(LSP_METHOD_DESTINATIONS_LOGON_STATE_CHANGED, (params) =>
    handleLogonStateChanged(params, log)
  )
}

export function openDefaultBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    return
  }
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

export async function getLogonState(
  connection: MessageConnection,
  destinationId: string
): Promise<string | undefined> {
  try {
    const info = (await connection.sendRequest('adtLs/destinations/getLogonInfo', destinationId)) as
      | { logonState?: string }
      | undefined
    return info?.logonState
  } catch {
    return undefined
  }
}

function buildLogonDidNotCompleteMessage(
  destinationId: string,
  state: string | undefined,
  err: unknown
): Error {
  return new Error(
    `Logon to ${destinationId} did not complete (${state ?? 'unknown'}): ${formatError(err)}`
  )
}

function buildLogonTimeoutMessage(destinationId: string, state: string | undefined): Error {
  const detail = lastLogonFailureMessage ?? state ?? 'unknown'
  return new Error(
    `Logon to ${destinationId} did not reach 'connected' (${detail}). ` +
      'Approve Secure Login / SSO if prompted. If this repeats: run with --verbose, ' +
      'stop stale adt-lsc (pkill adt-lsc on macOS/Linux, Get-Process adt-lsc | Stop-Process -Force on Windows), ' +
      'check ~/.openadt/local.openadt.toml jco_native_dir/sapcrypto.'
  )
}

async function awaitEnsureLoggedOnResponse(
  connection: MessageConnection,
  destinationId: string,
  timeoutMs: number,
  log: McpLog | undefined
): Promise<string | undefined> {
  try {
    await withTimeout(
      connection.sendRequest('adtLs/destinations/ensureLoggedOn', destinationId),
      timeoutMs,
      'adtLs/destinations/ensureLoggedOn'
    )
    log?.info(`LSP ← ensureLoggedOn ${destinationId} ok`)
    return undefined
  } catch (err) {
    const state = await getLogonState(connection, destinationId)
    if (state === 'connected') {
      log?.info(`ensureLoggedOn timed out but logonState=connected`)
      return undefined
    }
    throw buildLogonDidNotCompleteMessage(destinationId, state, err)
  }
}

function announceLogonStart(
  destinationId: string,
  timeoutMs: number,
  log: McpLog | undefined
): void {
  lastLogonFailureMessage = undefined
  console.error(
    `[openadt-mcp] Starting SAP logon for ${destinationId} — approve SSO / Secure Login if a window opens (timeout ${Math.round(timeoutMs / 1000)}s).`
  )
  log?.info(`LSP → adtLs/destinations/ensureLoggedOn ${destinationId}`)
}

export async function ensureDestinationLoggedOn(
  connection: MessageConnection,
  destinationId: string,
  options: { timeoutMs: number; log?: McpLog }
): Promise<void> {
  const { timeoutMs, log } = options
  announceLogonStart(destinationId, timeoutMs, log)
  await awaitEnsureLoggedOnResponse(connection, destinationId, timeoutMs, log)
  const state = await getLogonState(connection, destinationId)
  if (state !== 'connected') {
    throw buildLogonTimeoutMessage(destinationId, state)
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
