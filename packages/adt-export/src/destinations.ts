import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Minimal ADT Language Server destination-store access, independent of MCP. */
export function adtlsHomeDir(): string {
  return process.env.ADTLS_HOME ?? join(homedir(), '.adtls')
}

export function deriveDestinationIds(): string[] {
  const file = join(adtlsHomeDir(), 'destinations.json')
  if (!existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    destinations?: Array<{ id?: string }>
  }
  return [
    ...new Set(
      (parsed.destinations ?? []).map((r) => r.id?.trim()).filter((id): id is string => Boolean(id))
    ),
  ].sort()
}
