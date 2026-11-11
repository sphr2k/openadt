/**
 * Own-mode backend lifecycle.
 *
 * Spawns and supervises our own `adt-lsc`: LSP handshake (with destinations
 * registered from the ADT LS store), `startMCPServer`, HTTP readiness wait, and
 * endpoint-store bookkeeping. The returned session's `connection` is reused
 * in-process for the `adt_*` LSP tool group, so one child backs both tool
 * groups. `shutdown()` tears the child down and removes the store record.
 */
import { createMcpLog, killProcessTree, locateAdtLs } from '@openadt/adt-infra'
import { connectAdtLanguageServer, type LspSession } from '@openadt/adt-lsp-client'
import type { McpServeConfig, McpStartParams } from '@openadt/adt-config'
import { deriveDestinations } from './destinations.js'
import { writeEndpoint, removeEndpoint, type McpEndpointMode } from './endpoint-store.js'
import {
  generateMcpToken,
  buildDestinationAllowlist,
  setMcpDestination,
  startMcpServer,
  stopMcpServer,
  waitForMcpHttp,
  mcpUrl,
  isPortInUseMessage,
} from './sap-mcp/control.js'

export type OwnBackend = {
  session: LspSession
  port: number
  token: string
  destinations: string[]
  shutdown: () => Promise<void>
}

/**
 * Start an owned SAP HTTP MCP backend.
 *
 * @throws if the SAP ADT VS Code extension / `adt-lsc` cannot be located, or the
 *   LSP handshake / `startMCPServer` / HTTP readiness wait fails.
 */
export async function startOwnBackend(
  cfg: McpServeConfig,
  options: { mode?: McpEndpointMode; port?: number } = {}
): Promise<OwnBackend> {
  const install = locateAdtLs()
  if (!install) {
    throw new Error(
      'SAP ADT VS Code extension not found (sapse.adt-vscode). Install it from the marketplace or set ADT_LS_PATH.'
    )
  }

  const { storePath, ids } = deriveDestinations()
  const allowlist = buildDestinationAllowlist(ids)
  const log = createMcpLog({ verbose: cfg.verbose, logFile: cfg.logFile })
  const backendPort = options.port ?? cfg.port

  console.error(
    `[openadt-mcp] adt-lsc ${install.version} · workspace ${cfg.workspace} · ${ids.length} destination(s)`
  )

  const session = await connectAdtLanguageServer(install, cfg.workspace, {
    destinationsStorePath: storePath,
    createProjectIds: ids,
    // Logon to all destinations at startup in own mode to enable SAP tools
    // without requiring per-tool logon (SSO window appears once at startup).
    // In attach/shared mode, no LSP session is available for logon.
    ensureLoggedOnIds: ids,
    logonTimeoutMs: cfg.logonTimeoutMs,
    log,
  })

  const token = generateMcpToken()
  const started = await startMcpServerOnFreePort(session.connection, {
    startPort: backendPort,
    token,
    allowlist,
  })

  const ready = await waitForMcpHttp(started.port, started.token)
  if (!ready) {
    await safeStop(session)
    throw new Error(`SAP HTTP MCP did not become ready on port ${started.port}`)
  }

  // Only an explicit `--destination` pins the active destination at startup;
  // otherwise tools supply their own per-call.
  if (cfg.destination) {
    await setMcpDestination(session.connection, cfg.destination).catch((err: unknown) => {
      console.error(`[openadt-mcp] setDestination(${cfg.destination}) failed: ${String(err)}`)
    })
  }

  writeEndpoint({
    port: started.port,
    url: mcpUrl(started.port),
    token: started.token,
    pid: process.pid,
    adtLscPid: session.child.pid,
    startedAt: new Date().toISOString(),
    destination: cfg.destination,
    destinations: ids,
    workspace: cfg.workspace,
    mode: options.mode ?? 'standalone',
  })

  let stopped = false
  const shutdown = async (): Promise<void> => {
    if (stopped) {
      return
    }
    stopped = true
    await safeStop(session)
    removeEndpoint(started.port)
  }

  return {
    session,
    port: started.port,
    token: started.token,
    destinations: ids,
    shutdown,
  }
}

/** Max sequential ports tried when the requested port is already bound. */
const MAX_PORT_ATTEMPTS = 32
const MAX_PORT = 65535

/**
 * Start the SAP HTTP MCP, auto-incrementing the port when it is already in use.
 *
 * Only port-in-use failures are retried; any other error is rethrown
 * immediately. Throws if no free port is found within {@link MAX_PORT_ATTEMPTS}.
 */
async function startMcpServerOnFreePort(
  connection: Parameters<typeof startMcpServer>[0],
  options: {
    startPort: number
    token: string
    allowlist: NonNullable<McpStartParams['allowlist']>
  }
): Promise<{ port: number; token: string }> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = Math.min(options.startPort + attempt, MAX_PORT)
    try {
      return await startMcpServer(connection, {
        port,
        token: options.token,
        allowlist: options.allowlist,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (!isPortInUseMessage(error.message)) {
        throw error
      }
      console.error(`[openadt-mcp] port ${port} in use, trying ${port + 1}...`)
    }
  }
  throw new Error(
    `Port ${options.startPort} already in use; auto-increment failed after ${MAX_PORT_ATTEMPTS} attempts (up to port ${MAX_PORT})`
  )
}

async function safeStop(session: LspSession): Promise<void> {
  try {
    await stopMcpServer(session.connection)
  } catch {
    /* best effort */
  }
  try {
    session.connection.dispose()
  } catch {
    /* already disposed */
  }
  killProcessTree(session.child)
}
