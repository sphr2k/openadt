import { join } from 'node:path'
import type { LspTransport } from '@openadt/adt-lsp-client'
import { canonicalPackageName, matchesPackage, type ExportConfig } from './config.js'
import {
  childUri,
  readDirectory,
  safeSegment,
  type PackageRoot,
  type SourceFile,
} from './repository.js'

export type SweepResult = { files: SourceFile[]; directories: number }

export async function sweep(
  lsp: LspTransport,
  cfg: ExportConfig,
  roots: PackageRoot[],
  report: (directories: number, files: number) => void = () => {}
): Promise<SweepResult> {
  const pending = roots.map((root) => ({
    uri: root.directory,
    relative: safeSegment(root.folder),
  }))
  const visited = new Set<string>()
  const files = new Map<string, SourceFile>()
  let directories = 0
  while (pending.length) {
    const dir = pending.pop()!
    if (visited.has(dir.uri)) continue
    visited.add(dir.uri)
    const children = await readDirectory(lsp, dir.uri)
    directories++
    for (const entry of children) {
      const name = safeSegment(entry.name)
      const uri = childUri(dir.uri, name)
      const relative = join(dir.relative, name)
      if (entry.type === 2) {
        if (!matchesPackage(canonicalPackageName(name), cfg.exclude.map(canonicalPackageName))) {
          pending.push({ uri: uri + '/', relative })
        }
      } else if (entry.type === 1) {
        const key = relative.toLowerCase()
        const previous = files.get(key)
        if (previous && previous.uri !== uri) {
          throw new Error('Output file collision: ' + relative)
        }
        files.set(key, { uri, relative })
      } else {
        throw new Error('Unexpected SAP filesystem node type ' + entry.type + ' at ' + uri)
      }
    }
    if (directories === 1 || directories % 25 === 0) report(directories, files.size)
  }
  report(directories, files.size)
  return {
    directories,
    files: [...files.values()].sort((a, b) => a.relative.localeCompare(b.relative)),
  }
}
