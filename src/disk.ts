// Storage layer: the OPFS site root and raw read/write/list/remove relative to `state.root`. No UI.
import { state } from './state'
import type { Entries } from './state'

// ---------------------------------------------------------------------------
// OPFS — the site folder: sites/<name>/
// ---------------------------------------------------------------------------
export async function opfsSiteRoot(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const sites = await root.getDirectoryHandle('sites', { create: true })
  return sites.getDirectoryHandle(name, { create: true })
}

// ---------------------------------------------------------------------------
// Raw I/O (paths relative to state.root, "/"-separated)
// ---------------------------------------------------------------------------
async function dirAt(parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
  let dir = state.root!
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export async function readText(path: string): Promise<string> {
  const parts = path.split('/')
  const name = parts.pop()!
  const fh = await (await dirAt(parts)).getFileHandle(name)
  return (await fh.getFile()).text()
}

export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readText(path)
  } catch {
    return null
  }
}

export async function writeText(path: string, text: string): Promise<void> {
  const parts = path.split('/')
  const name = parts.pop()!
  const fh = await (await dirAt(parts, true)).getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

// Removes a file or folder; a missing path is not an error.
export async function removePath(path: string): Promise<void> {
  const parts = path.split('/')
  const name = parts.pop()!
  try {
    await (await dirAt(parts)).removeEntry(name, { recursive: true })
  } catch {
    /* already gone */
  }
}

// Every file under `prefix` (recursive) as root-relative paths; [] if the folder is missing.
export async function listFiles(prefix: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: FileSystemDirectoryHandle, base: string): Promise<void> {
    for await (const [name, h] of (dir as any).entries() as Entries) {
      if (h.kind === 'file') out.push(`${base}/${name}`)
      else await walk(h as FileSystemDirectoryHandle, `${base}/${name}`)
    }
  }
  try {
    await walk(await dirAt(prefix.split('/')), prefix)
  } catch {
    /* folder missing */
  }
  return out
}

// Run an async task over items with bounded concurrency: each batch of `size`
// runs in parallel, and the next batch starts only once the current one settles.
export async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(task))
  }
}
