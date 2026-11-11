/**
 * SAP ADT MCP control plane.
 *
 * Thin wrappers over the `adtLs/mcp/*` LSP methods exposed by `adt-lsc`, plus
 * the HTTP `/mcp` readiness probe. The SAP MCP server runs *inside* adt-lsc and
 * is reachable only over HTTP after `startMCPServer`; these helpers drive that
 * lifecycle from the owned LSP connection. Ported from the launcher in `main`.
 */
import { randomUUID } from 'node:crypto'
import { ParameterStructures, sleep, type MessageConnection } from '@openadt/adt-infra'
import {
  LSP_METHOD_MCP_SET_DESTINATION,
  LSP_METHOD_MCP_START,
  LSP_METHOD_MCP_STOP,
  type McpStartParams,
  type McpStartResult,
} from '@openadt/adt-config'

/** URL-safe Bearer token for the SAP HTTP MCP server. */
export function generateMcpToken(): string {
  return randomUUID()
}

export function buildDestinationAllowlist(ids: string[]): NonNullable<McpStartParams['allowlist']> {
  if (ids.some((id) => !id.trim() || /[,*?\r\n]/.test(id))) {
    throw new Error('Destination IDs cannot contain allowlist patterns or separators')
  }
  return { destinations: ids.join(','), packages: '', namespaces: '*' }
}

/** `adtLs/mcp/startMCPServer` — boot the embedded Jetty HTTP MCP on localhost. */
export async function startMcpServer(
  connection: MessageConnection,
  params: McpStartParams
): Promise<McpStartResult> {
  const result = (await connection.sendRequest(
    LSP_METHOD_MCP_START,
    ParameterStructures.byName,
    params
  )) as McpStartResult | undefined
  if (!result?.port || !result?.token) {
    throw new Error(
      `adtLs/mcp/startMCPServer returned invalid payload: ${summarizeMcpStart(result)}`
    )
  }
  return result
}

function summarizeMcpStart(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return typeof result
  }
  const obj = result as Record<string, unknown>
  return `{${Object.keys(obj)
    .map((k) => `${k}:<${typeof obj[k]}>`)
    .join(', ')}}`
}

/** `adtLs/mcp/stopMCPServer` — stop the HTTP MCP listener (best effort). */
export async function stopMcpServer(connection: MessageConnection): Promise<void> {
  await connection.sendRequest(LSP_METHOD_MCP_STOP)
}

/** `adtLs/mcp/setDestination` — register destination-scoped dynamic tools. */
export async function setMcpDestination(
  connection: MessageConnection,
  destinationId: string
): Promise<void> {
  await connection.sendRequest(LSP_METHOD_MCP_SET_DESTINATION, ParameterStructures.byName, {
    destinationId,
  })
}

export function mcpUrl(port: number): string {
  return `http://localhost:${port}/mcp`
}

export function isPortInUseMessage(message: string): boolean {
  return /port.*already in use/i.test(message)
}

/** Consume response body so poll probes do not leak open HTTP/SSE connections. */
export async function drainHttpResponse(res: Response): Promise<void> {
  try {
    await res.arrayBuffer()
  } catch {
    /* ignore drain errors — status already available */
  }
}

/** True when the HTTP MCP listener is bound (any HTTP response, no MCP session created). */
export async function probeMcpHttp(port: number, token?: string): Promise<boolean> {
  const headers: Record<string, string> = {
    'User-Agent': 'openadt-mcp-client',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  try {
    // OPTIONS proves the listener is bound without creating MCP sessions. Do not
    // POST initialize here — unread/streaming probe bodies stall later tools/list.
    const res = await fetch(mcpUrl(port), {
      method: 'OPTIONS',
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    await drainHttpResponse(res)
    return true
  } catch {
    return false
  }
}

/** Poll until MCP HTTP accepts requests (startMCPServer may return before bind). */
export async function waitForMcpHttp(
  port: number,
  token: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeMcpHttp(port, token)) {
      return true
    }
    await sleep(intervalMs)
  }
  return false
}

/** Agent-neutral HTTP MCP client connection (url + Authorization header). */
export function mcpHttpClientConfig(port: number, token: string): object {
  return {
    url: mcpUrl(port),
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'openadt-mcp-client',
    },
  }
}

export function redactToken(token: string): string {
  if (token.length <= 8) {
    return '***'
  }
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}
