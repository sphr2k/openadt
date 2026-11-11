import { randomUUID, createHash } from 'node:crypto'
import { appendFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { SourceFile } from './repository.js'

type Completion = { system: string; uri: string; relative: string; sha256: string }

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function statOrNull(path: string) {
  try {
    return await lstat(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

async function rejectSymlink(path: string): Promise<void> {
  const stat = await statOrNull(path)
  if (stat?.isSymbolicLink()) throw new Error('Symlink in export target: ' + path)
}

/** Keep all writes inside the target root and refuse existing symlink components. */
export async function safeOutput(root: string, rel: string): Promise<string> {
  const full = resolve(root, rel)
  if (
    relative(root, full).startsWith('..' + sep) ||
    full === root ||
    relative(root, full) === '..'
  ) {
    throw new Error('File path escapes export root: ' + rel)
  }
  await rejectSymlink(root)
  const segments = relative(root, full).split(sep)
  let current = root
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..')
      throw new Error('Invalid export path: ' + rel)
    current = join(current, segment)
    await rejectSymlink(current)
  }
  return full
}

export class ExportJournal {
  private readonly completed = new Map<string, Completion>()
  private chain: Promise<void> = Promise.resolve()
  private constructor(
    readonly target: string,
    readonly system: string,
    readonly filename: string
  ) {}

  private key(file: SourceFile): string {
    return this.system + '\0' + file.uri + '\0' + file.relative
  }

  static async open(target: string, system: string): Promise<ExportJournal> {
    const filename = join(target, '.openadt-export-state.jsonl')
    await rejectSymlink(target)
    await mkdir(target, { recursive: true })
    await rejectSymlink(filename)
    const journal = new ExportJournal(target, system, filename)
    try {
      const lines = (await readFile(filename, 'utf8')).split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        let value: Completion
        try {
          value = JSON.parse(line) as Completion
        } catch {
          continue // partial trailing record after unexpected process interruption
        }
        if (
          value.system !== system ||
          !value.uri ||
          !value.relative ||
          !/^[a-f0-9]{64}$/.test(value.sha256)
        )
          continue
        journal.completed.set(journal.key(value), value)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    return journal
  }

  async isComplete(file: SourceFile): Promise<boolean> {
    const previous = this.completed.get(this.key(file))
    if (!previous) return false
    const path = await safeOutput(this.target, file.relative)
    const stat = await statOrNull(path)
    if (!stat?.isFile()) return false
    return hash(await readFile(path)) === previous.sha256
  }

  async write(file: SourceFile, content: string): Promise<number> {
    const path = await safeOutput(this.target, file.relative)
    await mkdir(dirname(path), { recursive: true })
    // Race-safe second check after parent creation.
    await safeOutput(this.target, file.relative)
    const data = Buffer.from(content, 'utf8')
    const tmp = path + '.openadt-' + randomUUID() + '.tmp'
    try {
      await writeFile(tmp, data, { flag: 'wx', mode: 0o600 })
      await rename(tmp, path)
    } finally {
      await rm(tmp, { force: true })
    }
    const value: Completion = {
      system: this.system,
      uri: file.uri,
      relative: file.relative,
      sha256: hash(data),
    }
    this.chain = this.chain.then(async () => {
      await appendFile(this.filename, JSON.stringify(value) + '\n', { encoding: 'utf8' })
      this.completed.set(this.key(file), value)
    })
    await this.chain
    return data.byteLength
  }
}
