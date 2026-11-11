# Codex handover — headless ABAP tree export (2026-11-11)

Branch: feat/export-yaml-packages
Issues: #1 (YAML CLI), #2 (preflight sweep/progress), #3 (resumable downloads).

## Architecture
- `packages/adt-export/`: core package, no MCP dependencies/imports.
- Depends on shared `adt-lsp-client` / `adt-infra` / `adt-config` and YAML.
- Java `openadt export` invokes the Bun entrypoint as a subprocess.
- Distribution bundles independent `bin/adt-export.mjs`. Later compile with `bun build --compile` to a self-contained executable.
- No running VS Code is required. SAP-supplied `adt-lsc` runtime is still needed.

## Implemented
- YAML package patterns with * globs, system, target, exclude, jobs and maxResults.
- Package quickSearch (DEVC/K), getLsUri resolution, preflight readDirectory sweep.
- Text-preserving readFile exports for source and metadata, bounded parallel reads.
- Progress from planned total, local SHA-256 resume journal and atomic writes.
- --dry-run, --refresh, exit failure on incomplete export.

## Verification
- Five mock-LSP tests PASS (ABAP + JSON, tree, wildcard, sweep, resume, refresh, paths).
- TypeScript tsc PASS, Nx package build PASS, standalone Bun bundle + help PASS.
- Maven distribution verify PASS, spec-sync and package-doc checks PASS.
- ESLint source has **six complexity warnings** remaining (no source errors).
- **NO REAL SAP TEST** was possible here. Mock parity does not prove official Tree Export parity.

## Remaining (Codex)
1. Compare against SAP's official Subtree Export on one *small* authorized package: filenames, nested paths, .abap contents, .json metadata, file count, version semantics. Start dry-run.
2. Validate real SAP quickSearch wildcard support, namespace canonicalization, DEVC/K type, getLsUri directory derivation and readDirectory return shapes. Fix real parity issues.
3. Keep export logic independent of MCP. Do not move it back into adt-mcp.
4. Tighten symlink containment (including ancestors), partial journal handling, retries (transient errors only), cancellation, progress/reporting. Add tests for failures.
5. Clear ESLint complexity warnings; run CI and CodeScene gates before merge.
6. Run full package-release ZIP smoke. Verify Java CLI finds bundled script, Bun runtime, and independent --compile path.

## Local run
`MISE_BUN_VERSION=1.3.14 MISE_NODE_VERSION=24.22.1 bun test packages/adt-export/src/export.test.ts`
`MISE_BUN_VERSION=1.3.14 MISE_NODE_VERSION=24.22.1 bunx tsc -p packages/adt-export/tsconfig.json --noEmit`
`MISE_BUN_VERSION=1.3.14 MISE_NODE_VERSION=24.22.1 bunx nx run adt-export:build`
`./mvnw -q verify -Pdistribution -Dopenadt.distribution=true`

No SAP credentials, proprietary SAP bundles or real SAP data belong in the repository.
