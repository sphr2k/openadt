import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve, join } from 'node:path'
import { load } from 'js-yaml'

export type ExportConfig = {
  system: string
  target: string
  packages: string[]
  exclude: string[]
  jobs: number
  maxResults: number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Export YAML must contain a mapping/object')
  }
  return value as Record<string, unknown>
}

function stringList(value: unknown, field: string, required: boolean): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(field + ' must be a ' + (required ? 'nonempty ' : '') + 'YAML list')
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(field + ' entries must be nonempty strings')
    }
    if (/[\u0000-\u001f]/.test(entry)) throw new Error('Invalid control character in ' + field)
  }
  return value.map((s: string) => s.trim())
}

function integer(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new Error(field + ' must be an integer from 1 to ' + max)
  }
  return value as number
}

export function globRegex(pattern: string): RegExp {
  if (!pattern || pattern.includes('?') || pattern.includes('[') || pattern.includes(']')) {
    throw new Error('Invalid package glob: ' + pattern + ' (only * is supported)')
  }
  const escaped = pattern.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp('^' + escaped + '$', 'i')
}

export function matchesPackage(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globRegex(pattern).test(name))
}

/** Convert SAP's filesystem namespace form to canonical package names for matching. */
export function canonicalPackageName(name: string): string {
  return name.replace(/^\(([^)]+)\)/, '/$1/').toUpperCase()
}

function targetPath(input: string, configPath: string): string {
  const expanded =
    input === '~' ? homedir() : input.startsWith('~/') ? join(homedir(), input.slice(2)) : input
  return resolve(isAbsolute(expanded) ? expanded : resolve(dirname(configPath), expanded))
}

export function validateConfig(value: unknown, configPath: string): ExportConfig {
  const cfg = record(value)
  for (const key of Object.keys(cfg)) {
    if (!['system', 'target', 'packages', 'exclude', 'jobs', 'maxResults'].includes(key)) {
      throw new Error('Unknown export config field: ' + key)
    }
  }
  if (typeof cfg.system !== 'string' || !cfg.system.trim()) throw new Error('system is required')
  if (typeof cfg.target !== 'string' || !cfg.target.trim()) throw new Error('target is required')
  const packages = stringList(cfg.packages, 'packages', true)
  const exclude = stringList(cfg.exclude, 'exclude', false)
  for (const pattern of [...packages, ...exclude]) globRegex(pattern)
  return {
    system: cfg.system.trim(),
    target: targetPath(cfg.target, configPath),
    packages,
    exclude,
    jobs: integer(cfg.jobs, 'jobs', 4, 16),
    maxResults: integer(cfg.maxResults, 'maxResults', 10000, 50000),
  }
}

export async function loadExportConfig(configPath: string): Promise<ExportConfig> {
  const absolute = resolve(configPath)
  return validateConfig(load(await readFile(absolute, 'utf8')), absolute)
}
