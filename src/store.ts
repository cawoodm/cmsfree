// The model and its persistence: load content/ from the storage root into memory,
// autosave changed files after 1 s, replace content after a pull, compare to the base.
import { model, state, META_PATH } from './state'
import type { Meta } from './state'
import { inBatches, listFiles, readTextOrNull, removePath, writeText } from './disk'
import { blobSha } from './format'
import { setButtons, setStatus } from './chrome'

const SAVE_DELAY = 1000
let timer: number | undefined
let queue: Promise<void> = Promise.resolve()

const isContentFile = (p: string) => /(^|\/)(site\.yml|[^/]+\.md)$/.test(p)

// Every folder directly under content/ holds the content of one page.
function detectDirs(): void {
  const dirs = new Set<string>()
  for (const p of model.keys()) {
    const m = /^content\/([^/]+)\//.exec(p)
    if (m) dirs.add(m[1])
  }
  state.dirs = [...dirs].sort()
}

export async function loadModel(): Promise<void> {
  model.clear()
  state.dirty.clear()
  for (const p of (await listFiles('content')).filter(isContentFile)) model.set(p, (await readTextOrNull(p)) ?? '')
  detectDirs()
}

export async function readMeta(): Promise<Meta | null> {
  const raw = await readTextOrNull(META_PATH)
  try {
    return raw ? (JSON.parse(raw) as Meta) : null
  } catch {
    return null
  }
}

export async function writeMeta(meta: Meta): Promise<void> {
  state.base = meta
  await writeText(META_PATH, JSON.stringify(meta))
}

// Browser mode: replace the local content/ folder entirely with pulled files and store the new base.
export async function replaceContent(files: Record<string, string>, meta: Meta): Promise<void> {
  clearTimeout(timer)
  state.dirty.clear()
  state.savePending = false
  await removePath('content')
  await inBatches(Object.keys(files), 8, (p) => writeText(p, files[p]))
  await writeMeta(meta)
  await loadModel()
}

// ---------------------------------------------------------------------------
// Edits + autosave
// ---------------------------------------------------------------------------
export function setFile(path: string, text: string): void {
  model.set(path, text)
  if (!state.dirs.includes(path.split('/')[1])) detectDirs()
  state.dirty.add(path)
  state.savePending = true
  clearTimeout(timer)
  timer = window.setTimeout(() => void flush(), SAVE_DELAY)
  void updateStatus()
}

// Writes the changed files now (serialised, so calls never overlap).
export function flush(): Promise<void> {
  clearTimeout(timer)
  queue = queue.then(async () => {
    const paths = [...state.dirty]
    state.dirty.clear()
    try {
      await inBatches(paths, 8, (p) => writeText(p, model.get(p) ?? ''))
    } catch (err) {
      for (const p of paths) state.dirty.add(p)
      setStatus('Saving failed: ' + (err as Error).message)
      return
    } finally {
      state.savePending = state.dirty.size > 0
    }
    await updateStatus()
  })
  return queue
}

// Files whose git blob sha differs from the base (new files included).
export async function changedFiles(): Promise<{ path: string; text: string; sha: string }[]> {
  const out: { path: string; text: string; sha: string }[] = []
  for (const [path, text] of model) {
    const sha = await blobSha(text)
    if (sha !== state.base?.files[path]) out.push({ path, text, sha })
  }
  return out
}

// Status line: unpublished changes (browser mode) or the folder save state (folder mode).
export async function updateStatus(): Promise<void> {
  if (state.mode === 'folder') {
    setStatus(state.savePending ? 'Saving…' : 'Saved to folder')
    return
  }
  const n = (await changedFiles()).length
  setStatus(state.savePending ? 'Saving…' : n ? `${n} unpublished change${n > 1 ? 's' : ''}` : 'No unpublished changes')
  setButtons({ publishEnabled: n > 0 })
}
