# Headless ABAP package export

`openadt export --config <file.yaml>` inventories selected SAP packages and exports
their virtual ADT Language Server filesystem representation (AFF source and metadata)
without requiring a running VS Code process. The current backend uses the original
SAP `adt-lsc` binary installed alongside SAP ADT; the binary must be locatable via
`ADT_LS_PATH` or extension discovery. A configured destination must exist in
the ADT LS destination store (`~/.adtls/destinations.json`).

## YAML schema

```yaml
system: DEV
target: ~/Downloads/ABAP
packages:
  - ZPKG
  - ZAPP_*
exclude:
  - ZAPP_TEST*
jobs: 4
maxResults: 10000
```

- `system`: exact ADT LS destination identifier.
- `target`: output directory; relative paths are relative to YAML, `~` expands to HOME.
- `packages`: nonempty list of exact names or `*` patterns. Matching
  is case-insensitive against complete package names. `*` matches any sequence.
  Search uses `adtLs/repository/quickSearch` with `DEVC/K`; results are
  filtered locally. Unmatched or truncated patterns fail.
- `exclude`: optional patterns applied to discovered roots and matching subpackages.
- `jobs`: concurrent file reads, 1..16 (default 4).
- `maxResults`: search limit, 1..50000 (default 10000). Reaching the
  limit fails as possibly truncated.
- Unknown keys, wrong types and invalid patterns fail at startup.

## Module boundaries\n\nExport domain code lives in `packages/adt-export`, not in `adt-mcp`. The\nmodule only depends on shared `adt-lsp-client`, `adt-infra` and `adt-config`\nfor the SAP Language Server session, plus YAML parsing. It never starts MCP,\nopens a MCP port, or requires a running VS Code process. The Java `openadt export`\ncommand is a thin process launcher for the standalone Bun-based `adt-export`\nbinary, the bundled `bin/adt-export.mjs` runtime (Bun required),\nor the source CLI from a checkout. This boundary supports a later\nseparately distributed minimal binary.\n\n## Execution

1. Connect to the SAP Language Server using the standalone `adt-export` module, using `adt-lsp-client`.
2. Discover packages with `quickSearch`, resolve with `getLsUri`, convert
   package file URIs to directories, remove nested selected roots.
3. Sweep directories with `adtLs/fileSystem/readDirectory` without fetching
   file contents. Print scanned-directory and discovered-file counts; a
   percentage is not known until discovery completes.
4. Export all planned files with `adtLs/fileSystem/readFile`. Keep category,
   object and AFF metadata layout under `<target>/<package-name>/...`.
   Write the LSP-provided content as UTF-8; reject unsupported placeholders.
5. Show completed/total and an exported/skipped/failed summary.
   Return nonzero on partial failure.

`--dry-run` performs the sweep without writing files. `--refresh` forces
rereads. Resume is automatic: `.openadt-export-state.jsonl` records successful
writes keyed by system + source URI + local relative path and SHA-256. Completed
files are skipped only after verifying the local hash. This does not detect
changes on SAP between runs: use `--refresh` for a fresh snapshot.

Writes are atomic (temporary sibling then rename); symlink path components,
unsafe paths, and duplicate output paths fail. Transient remote reads receive
bounded retry/backoff. Interrupted jobs can be restarted.
