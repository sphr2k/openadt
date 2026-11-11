/** SAP ADT language server custom LSP methods (adt-ls-client-protocol, not on npm). */
export const LSP_METHOD_DESTINATIONS_INIT = 'adtLs/destinations/initializeService'
export const LSP_METHOD_DESTINATIONS_ENSURE_LOGON = 'adtLs/destinations/ensureLoggedOn'
export const LSP_METHOD_DESTINATIONS_CREATE_PROJECT = 'adtLs/destinations/createProject'
export const LSP_METHOD_DESTINATIONS_LIST = 'adtLs/destinations/list'
export const LSP_METHOD_DESTINATIONS_GET_STORE_PATH = 'adtLs/destinations/getStorePath'
export const LSP_METHOD_DESTINATIONS_GET_LOGON_INFO = 'adtLs/destinations/getLogonInfo'
export const LSP_METHOD_DESTINATIONS_REQUEST_BROWSER_LOGON =
  'adtLs/destinations/requestBrowserBasedLogon'
export const LSP_METHOD_DESTINATIONS_REQUEST_LOGON_INPUT = 'adtLs/destinations/requestLogonInput'
export const LSP_METHOD_DESTINATIONS_STOP_LOGON = 'adtLs/destinations/stopLogonAttempt'
export const LSP_METHOD_DESTINATIONS_LOGON_STATE_CHANGED = 'adtLs/destinations/logonStateChanged'
export const LSP_METHOD_MCP_START = 'adtLs/mcp/startMCPServer'
export const LSP_METHOD_MCP_STOP = 'adtLs/mcp/stopMCPServer'
export const LSP_METHOD_MCP_SET_DESTINATION = 'adtLs/mcp/setDestination'

// Repository + filesystem methods that back VS Code's `adt-vscode.openAbapObject`.
// The by-name read chain is: quickSearch (name → ADT path) → getLsUri (ADT path →
// repotree/AFF URI) → readFile (URI → source). See docs/plans/2026-06-07-mcp-read-abap-object.md.
export const LSP_METHOD_REPOSITORY_QUICK_SEARCH = 'adtLs/repository/quickSearch'
export const LSP_METHOD_REPOSITORY_GET_LS_URI = 'adtLs/repository/getLsUri'
export const LSP_METHOD_FILESYSTEM_READ_FILE = 'adtLs/fileSystem/readFile'
export const LSP_METHOD_FILESYSTEM_FORCE_REFRESH = 'adtLs/fileSystem/forceRefresh'

/** One repository object hit from `quickSearch`. `uri` is the ADT object path. */
export type AdtObjectReference = {
  name: string
  description?: string
  type?: string
  /** ADT object path, e.g. `/sap/bc/adt/oo/classes/cl_x`. Feed to `getLsUri`. */
  uri?: string
}

export type QuickSearchResult = {
  references?: AdtObjectReference[]
  message?: { label?: string; detail?: string; severity?: number }
}

export const DEFAULT_MCP_PORT = 2236
export const DEFAULT_LOGON_TIMEOUT_MS = 300_000
export const MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode'

export type AdtLsInstall = {
  extensionRoot: string
  adtLscPath: string
  adtLsRoot: string
  version: string
}

export type DestinationsInitParams = {
  destinationsStorePath: string
  workspaceFolderUris: string[]
  fileUris: string[]
}

export type McpStartParams = {
  port: number
  token: string
  allowlist?: { destinations: string; packages: string; namespaces: string }
}

export type McpStartResult = {
  port: number
  token: string
  version?: string
}

export type DestinationImportMode = 'auto' | 'adtls' | 'gui' | 'openadt' | 'none'

/** Default `serve --import-from`: ADT LS store (Eclipse/ADT logon destinations). */
export const DEFAULT_IMPORT_FROM: DestinationImportMode = 'adtls'

export type McpServeConfig = {
  port: number
  /** When true, --port (or OPENADT_MCP_PORT) was set explicitly on the CLI. */
  explicitPort: boolean
  workspace: string
  /** When true, --workspace was set explicitly on the CLI. */
  explicitWorkspace: boolean
  importFrom: DestinationImportMode
  destination?: string
  json: boolean
  showToken: boolean
  verbose: boolean
  logFile?: string
  logonTimeoutMs: number
  /** Stdio MCP transport (default). Serves the mesh over stdin/stdout. */
  stdio: boolean
  /** HTTP MCP transport (`--http`). Serves the mesh over Streamable HTTP `/mcp`. */
  http: boolean
  /** Proxy mode: 'proxy' serves SAP + custom tools, 'no-proxy' serves only custom tools. */
  proxyMode: 'proxy' | 'no-proxy'
  /** Monolithic mode: own adt-lsc, kill on exit. Default false (shared). */
  standalone: boolean
  /** Shared stdio: stop any existing daemon first so a fresh one spawns. */
  restart: boolean
  /** When true, include adt-lsp-mcp tools as additional MCP tools (own mode only). */
  lsp: boolean
  /**
   * SAP source: attach to an already-running/handed-out SAP MCP HTTP server on
   * this port instead of spawning our own adt-lsc. SAP tools only (no in-process LSP).
   */
  sapPort?: number
  /** Bearer token for an attached SAP MCP (`--sap-port`); read from endpoint store when omitted. */
  sapToken?: string
  /** Use a shared detached daemon (find/spawn via endpoint store). SAP tools only. */
  shared: boolean
}

export type McpRuntimeState = {
  url: string
  port: number
  token: string
  version?: string
  extensionVersion: string
  adtLscPath: string
  workspace: string
}
