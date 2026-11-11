# @openadt/adt-export

Independent, headless ABAP package tree exporter. **No MCP dependencies or
running VS Code process.** Uses the SAP-supplied `adt-lsc` binary through
```openadt/adt-lsp-client`.

## Usage

```bash
bun packages/adt-export/src/main.ts --config openadt-export.yaml --dry-run
bun packages/adt-export/src/main.ts --config openadt-export.yaml
```

The Java CLI offers the same operation as `openadt export --config ...`.
A release package bundles `bin/adt-export.mjs`, which requires Bun. A future
single-file compiled binary can be produced with:

```bash
bun build --compile packages/adt-export/src/main.ts --outfile adt-export
```

## Example YAML

```yaml
system: DEV
target: ~/Downloads/ABAP
packages:
  - ZAPP_*
exclude:
  - ZAPP_TEST*
jobs: 4
maxResults: 10000
```

`--dry-run` plans without writing; `--refresh` forces new remote reads.
By default, `.openadt-export-state.jsonl` skips previously verified local files.

The code is intentionally split into config, repository, sweep, writer,
runner and thin CLI files. This allows an independent binary or
alternate entrypoint without changing export behavior.

See [specs/export.md](../../specs/export.md) for the contract.
