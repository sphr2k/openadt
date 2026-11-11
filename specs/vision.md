# OpenADT product vision

## What OpenADT is

OpenADT is a **thin Java wrapper around the official SAP ADT SDK** (`com.sap.adt.*`). Tools and agents call SAP `/sap/bc/adt/...` through the same destination, session, and logon stack that Eclipse ADT uses — not a reimplemented ADT HTTP client.

## Product surface (MVP)

| Command         | Role                                                      |
| --------------- | --------------------------------------------------------- |
| `openadt fetch` | One ADT request from terminal or scripts                  |
| `openadt proxy` | Localhost HTTP bridge for IDE/curl (same transport stack) |

**Why Java:** SDK + JCo on the host OS is the supported path for SNC SSO and ADT session semantics. Raw HTTP and REST-RFC are **explicit fallbacks** (`adt.transport = http` / `rest-rfc`), not the default story.

## What OpenADT is not

- A full ADT IDE or Eclipse replacement
- A generic SAP HTTP client when SDK transport is available
- A landscape scanner that runs on every request (bootstrap writes config once)

## Configuration model

- **Runtime** reads `~/.openadt/config.toml` (no full-machine rescan per command).
- **`openadt setup`** / **`openadt config bootstrap`** — one-shot (or on demand) detection and SDK runtime jar build.

## Headless package export

`packages/adt-export` is an independent TypeScript module and CLI. It uses the
SAP-provided `adt-lsc` language server via the shared `adt-lsp-client`,
but has no dependency on the MCP package or a running VS Code process.
The Java CLI delegates `openadt export` to this module. See
[export.md](export.md) for the spec; it can later be distributed as a
standalone lightweight binary.

## Roadmap: MCP

MCP is a **separate installable** product, `openadt-mcp`: a standalone compiled Bun binary with its own Scoop bucket (`scoop install openadt-mcp`) and Homebrew tap (`brew install openadt-mcp`). It is the same launcher described in [mcp.md](mcp.md) — child `adt-lsc`, HTTP MCP, optional stdio bridge (`serve --stdio`). The Java `openadt mcp` subcommand stays and wraps `openadt-mcp`; OpenADT does not define MCP tools.

## Roadmap: Agent foundation (TypeScript)

OpenADT exposes LSP operations as MCP tools via a TypeScript-based agent layer within the `sap-adt-mcp-launcher`. This enables agent workflows to interact with SAP ADT through LSP methods without requiring direct ADT REST calls.

**Key features:**

- 18 LSP-based tools (ATC, lock/unlock, format, diagnostics, references, transport, search, etc.)
- Tools prefixed with `adt_` to distinguish from SAP MCP tools
- `--proxy` / `--no-proxy` flags to control tool exposure
- Available in standalone mode (direct LSP access)
- Throttling for high-volume operations (format, diagnostics, references)

See [adt-agent-typescript.md](adt-agent-typescript.md) for the full tool reference and implementation details.

## Package map (code navigation)

| Area                         | Package                           | Spec                                   |
| ---------------------------- | --------------------------------- | -------------------------------------- |
| SAP ADT SDK client           | `org.openadt.sap.adt.sdk`         | [cli.md](cli.md), [proxy.md](proxy.md) |
| Destinations                 | `org.openadt.sap.adt.destination` | [config.md](config.md)                 |
| JCo / Secure Login bootstrap | `org.openadt.sap.adt.bootstrap`   | [setup.md](setup.md)                   |
| HTTP / REST-RFC fallback     | `org.openadt.sap.adt.fallback.*`  | [cli.md](cli.md)                       |
| Fetch CLI glue               | `org.openadt.product.fetch`       | [cli.md](cli.md)                       |
| Proxy server                 | `org.openadt.product.proxy`       | [proxy.md](proxy.md)                   |
| Config TOML                  | `org.openadt.config`              | [config.md](config.md)                 |
| Setup detectors              | `org.openadt.bootstrap`           | [setup.md](setup.md)                   |

Module layout: [apps/ARCHITECTURE.md](../apps/ARCHITECTURE.md).

## Agent rules

1. Prefer SDK APIs for logon, session, and ADT requests.
2. Do not reimplement ADT HTTP unless `transport=http` is specified.
3. Spec changes require tests and `bun scripts/verify-spec-sync.ts` green.
4. Fictional fixtures only in repo content (`DEV`, `dev-ms.example.com`, etc.).
