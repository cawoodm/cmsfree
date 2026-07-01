// The File System Access + persistence layer: IndexedDB handle store, permission,
// connect, raw read/write, and directory copy/prune. No UI.
import { state } from './state'
import type { DirHandle, Entries } from './state'

// ---------------------------------------------------------------------------
// IndexedDB — persist the directory handle across reloads
// ---------------------------------------------------------------------------
const IDB_NAME = 'cmsfree'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'siteRoot'

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGetHandle(): Promise<DirHandle | undefined> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY)
    req.onsuccess = () => resolve(req.result as DirHandle | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function idbSetHandle(handle: DirHandle): Promise<void> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// File System Access — connect + permission
// ---------------------------------------------------------------------------
export async function verifyPermission(
  handle: DirHandle,
  request: boolean,
): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if (request && (await handle.requestPermission(opts)) === 'granted')
    return true
  return false
}

export async function connectDirectory(): Promise<DirHandle> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await idbSetHandle(handle)
  state.dirHandle = handle
  return handle
}

// ---------------------------------------------------------------------------
// Raw disk I/O (paths relative to the connected site root).
// ---------------------------------------------------------------------------
export async function resolveDir(
  parts: string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let dir: FileSystemDirectoryHandle = state.dirHandle!
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

export async function readFile(relPath: string): Promise<string> {
  const parts = relPath.split('/')
  const fileName = parts.pop()!
  const dir = await resolveDir(parts)
  const fh = await dir.getFileHandle(fileName)
  return (await fh.getFile()).text()
}

export async function writeFile(relPath: string, text: string): Promise<void> {
  const parts = relPath.split('/')
  const fileName = parts.pop()!
  const dir = await resolveDir(parts, true)
  const fh = await dir.getFileHandle(fileName, { create: true })
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

// Remove every entry in a directory except the named ones.
export async function removeAllExcept(
  dir: FileSystemDirectoryHandle,
  keep: Set<string>,
): Promise<void> {
  const names: string[] = []
  for await (const [name] of (dir as any).entries() as Entries) names.push(name)
  for (const name of names)
    if (!keep.has(name)) await dir.removeEntry(name, { recursive: true })
}

// Recursively copy every entry of srcDir into destDir.
export async function copyInto(
  srcDir: FileSystemDirectoryHandle,
  destDir: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, h] of (srcDir as any).entries() as Entries) {
    if (h.kind === 'file') {
      const buf = await (
        await (h as FileSystemFileHandle).getFile()
      ).arrayBuffer()
      const fh = await destDir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(buf)
      await w.close()
    } else {
      const sub = await destDir.getDirectoryHandle(name, { create: true })
      await copyInto(h as FileSystemDirectoryHandle, sub)
    }
  }
}
