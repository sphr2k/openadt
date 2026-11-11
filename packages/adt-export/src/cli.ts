import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import {
  connectAdtLanguageServer,
  disposeLspSession,
  LspConnectionTransport,
} from '@openadt/adt-lsp-client'
import { locateAdtLs } from '@openadt/adt-infra'
import { adtlsHomeDir, deriveDestinationIds } from './destinations.js'
import { loadExportConfig } from './config.js'
import { runExport } from './runner.js'

export type ExportArgs = { config: string; dryRun: boolean; refresh: boolean }

export function parseExportArgs(argv: string[]): ExportArgs {
  let config = 'openadt-export.yaml'
  let dryRun = false
  let refresh = false
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config':
      case '-c':
        if (!argv[i + 1] || argv[i + 1]!.startsWith('-'))
          throw new Error('--config needs a YAML filename')
        config = argv[++i]!
        break
      case '--dry-run':
        dryRun = true
        break
      case '--refresh':
        refresh = true
        break
      default:
        throw new Error('Unknown export option: ' + argv[i])
    }
  }
  return { config, dryRun, refresh }
}

export async function cmdExport(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: openadt export --config export.yaml [--dry-run] [--refresh]')
    return 0
  }
  const args = parseExportArgs(argv)
  const cfg = await loadExportConfig(args.config)
  const install = locateAdtLs()
  if (!install) {
    throw new Error('SAP adt-lsc not found; install SAP ADT or set ADT_LS_PATH')
  }
  const ids = deriveDestinationIds()
  if (!ids.includes(cfg.system)) {
    throw new Error(
      'Unknown ADT LS destination ' +
        cfg.system +
        ' (check ' +
        join(adtlsHomeDir(), 'destinations.json') +
        ')'
    )
  }
  const workspace = join(homedir(), '.openadt', 'export', 'lsp-workspace')
  await mkdir(workspace, { recursive: true })
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  const session = await connectAdtLanguageServer(install, workspace, {
    destinationsStorePath: adtlsHomeDir(),
    createProjectIds: [cfg.system],
    ensureLoggedOnIds: [cfg.system],
  })
  try {
    const result = await runExport(new LspConnectionTransport(session.connection), cfg, {
      dryRun: args.dryRun,
      refresh: args.refresh,
      signal: abort.signal,
    })
    return result.failed ? 1 : 0
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    await disposeLspSession(session)
  }
}
