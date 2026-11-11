import type { LspTransport } from '@openadt/adt-lsp-client'
import { canonicalPackageName, matchesPackage, type ExportConfig } from './config.js'

export type PackageRoot = { name: string; uri: string; directory: string; folder: string }
export type Entry = { name: string; type: number }
export type SourceFile = { uri: string; relative: string }

export function safeSegment(name: string): string {
  if (!name || name === '.' || name === '..' || /[/\\\u0000-\u001f]/.test(name)) {
    throw new Error('Unsafe SAP filesystem path component: ' + JSON.stringify(name))
  }
  return name
}

export function childUri(parent: string, name: string): string {
  safeSegment(name)
  if (!parent.endsWith('/')) throw new Error('Expected directory URI: ' + parent)
  return parent + encodeURIComponent(name)
}

export function packageDirectory(fileUri: string): string {
  if (!fileUri.startsWith('abap:/repotree-v1/') && !fileUri.startsWith('abap:/flat/')) {
    throw new Error('Unexpected SAP file URI: ' + fileUri)
  }
  const index = fileUri.lastIndexOf('/')
  if (index < 0) throw new Error('Invalid SAP URI: ' + fileUri)
  return fileUri.slice(0, index + 1)
}

export function packageFolder(directory: string): string {
  const segments = directory.replace(/\/$/, '').split('/')
  return safeSegment(decodeURIComponent(segments[segments.length - 1]!))
}

type QuickSearchResponse = {
  references?: Array<{ name?: string; uri?: string }>
  message?: { detail?: string }
}

export async function discoverPackageRoots(
  lsp: LspTransport,
  cfg: ExportConfig,
  report: (line: string) => void = () => {}
): Promise<PackageRoot[]> {
  const roots = new Map<string, PackageRoot>()
  for (const pattern of cfg.packages) {
    report('Finding packages: ' + pattern)
    const raw = (await lsp.sendRequest('adtLs/repository/quickSearch', {
      destination: cfg.system,
      pattern,
      types: ['DEVC/K'],
      maxResults: cfg.maxResults,
    })) as QuickSearchResponse
    const refs = raw?.references ?? []
    if (refs.length >= cfg.maxResults) {
      throw new Error(
        'Potentially truncated search for ' + pattern + ' (maxResults=' + cfg.maxResults + ')'
      )
    }
    const matching = refs.filter(
      (r) => r.name && matchesPackage(canonicalPackageName(r.name), [canonicalPackageName(pattern)])
    )
    if (!matching.length) throw new Error('No packages matched: ' + pattern)
    for (const ref of matching) {
      if (
        !ref.name ||
        !ref.uri ||
        matchesPackage(canonicalPackageName(ref.name), cfg.exclude.map(canonicalPackageName))
      )
        continue
      const response = (await lsp.sendRequest('adtLs/repository/getLsUri', {
        destination: cfg.system,
        adtUri: ref.uri,
      })) as { uri?: string }
      if (!response?.uri) throw new Error('getLsUri failed for ' + ref.name)
      const directory = packageDirectory(response.uri)
      roots.set(directory, {
        name: ref.name,
        uri: response.uri,
        directory,
        folder: packageFolder(directory),
      })
    }
  }
  const all = [...roots.values()].sort((a, b) => a.directory.localeCompare(b.directory))
  const filtered = all.filter(
    (root) =>
      !all.some(
        (other) => other.directory !== root.directory && root.directory.startsWith(other.directory)
      )
  )
  if (!filtered.length) throw new Error('No packages remain after exclusions')
  const folders = new Set<string>()
  for (const root of filtered) {
    if (folders.has(root.folder.toLowerCase())) {
      throw new Error('Output directory collision for package ' + root.name)
    }
    folders.add(root.folder.toLowerCase())
  }
  return filtered
}

export async function readDirectory(lsp: LspTransport, uri: string): Promise<Entry[]> {
  const result = (await lsp.sendRequest('adtLs/fileSystem/readDirectory', { uri })) as {
    children?: Entry[]
  }
  if (!result || (result.children !== undefined && !Array.isArray(result.children))) {
    throw new Error('Invalid readDirectory response for ' + uri)
  }
  return result.children ?? []
}

export async function readSource(lsp: LspTransport, uri: string): Promise<string> {
  const result = (await lsp.sendRequest('adtLs/fileSystem/readFile', { uri })) as {
    content?: string
  }
  if (typeof result?.content !== 'string') throw new Error('Missing file content: ' + uri)
  if (/not supported in ADT in VS Code/i.test(result.content)) {
    throw new Error('SAP reported an unsupported file: ' + uri)
  }
  return result.content
}
