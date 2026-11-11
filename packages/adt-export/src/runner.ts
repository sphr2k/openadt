import type { LspTransport } from '@openadt/adt-lsp-client'
import type { ExportConfig } from './config.js'
import { discoverPackageRoots, readSource, type SourceFile } from './repository.js'
import { sweep } from './sweep.js'
import { ExportJournal } from './writer.js'

export type ExportOptions = {
  dryRun?: boolean
  refresh?: boolean
  signal?: AbortSignal
  progress?: (line: string) => void
}
export type ExportResult = {
  packages: number
  directories: number
  files: number
  exported: number
  skipped: number
  failed: number
  bytes: number
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Export interrupted')
}

async function retryRead(lsp: LspTransport, uri: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    aborted(signal)
    try {
      return await readSource(lsp, uri)
    } catch (error) {
      if (attempt === 2 || String(error).includes('unsupported')) throw error
      await Bun.sleep(400 * 2 ** attempt)
    }
  }
  throw new Error('readFile exhausted retries: ' + uri)
}

type ExportRun = {
  lsp: LspTransport
  cfg: ExportConfig
  journal: ExportJournal
  opts: ExportOptions
  result: ExportResult
  progress: (line: string) => void
}

async function exportOne(file: SourceFile, run: ExportRun): Promise<void> {
  aborted(run.opts.signal)
  try {
    if (!run.opts.refresh && (await run.journal.isComplete(file))) {
      run.result.skipped++
      return
    }
    const content = await retryRead(run.lsp, file.uri, run.opts.signal)
    run.result.bytes += await run.journal.write(file, content)
    run.result.exported++
  } catch (error) {
    run.result.failed++
    run.progress('FAIL ' + file.relative + ': ' + String(error))
  }
}

async function exportFiles(files: SourceFile[], run: ExportRun): Promise<void> {
  let cursor = 0
  let lastReport = 0
  const worker = async () => {
    while (cursor < files.length) {
      aborted(run.opts.signal)
      const index = cursor++
      await exportOne(files[index]!, run)
      const done = run.result.exported + run.result.skipped + run.result.failed
      if (done === files.length || done - lastReport >= 25) {
        lastReport = done
        run.progress(
          'Export: ' +
            done +
            '/' +
            files.length +
            ' (' +
            Math.floor((100 * done) / files.length) +
            '%)' +
            '  new=' +
            run.result.exported +
            '  skipped=' +
            run.result.skipped +
            '  failed=' +
            run.result.failed
        )
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(run.cfg.jobs, files.length) }, worker))
}

export async function runExport(
  lsp: LspTransport,
  cfg: ExportConfig,
  opts: ExportOptions = {}
): Promise<ExportResult> {
  const progress = opts.progress ?? console.error
  aborted(opts.signal)
  const roots = await discoverPackageRoots(lsp, cfg, (line) => progress(line))
  progress('Sweep: starting ' + roots.length + ' selected package root(s)')
  const plan = await sweep(lsp, cfg, roots, (directories, files) => {
    progress('Sweep: ' + directories + ' directories; ' + files + ' files discovered')
  })
  aborted(opts.signal)
  const result: ExportResult = {
    packages: roots.length,
    directories: plan.directories,
    files: plan.files.length,
    exported: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
  }
  progress('Plan: ' + plan.files.length + ' files in ' + plan.directories + ' directories')
  if (opts.dryRun || !plan.files.length) return result
  const journal = await ExportJournal.open(cfg.target, cfg.system)
  const run: ExportRun = { lsp, cfg, journal, opts, result, progress }
  await exportFiles(plan.files, run)
  progress(
    'Complete: exported=' +
      result.exported +
      ' skipped=' +
      result.skipped +
      ' failed=' +
      result.failed +
      ' bytes=' +
      result.bytes
  )
  return result
}
