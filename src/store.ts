// The model and its persistence: load the site files (content/blocks, i18n/*.yaml, hugo.toml) from the storage root
// into memory, autosave changed files after 1 s, replace them after a pull, compare to the base.
import { model, state, META_PATH } from './state'
import type { Meta } from './state'
import { inBatches, listFiles, readTextOrNull, removePath, writeText } from './disk'
import { SITE_CONFIG, blobSha, blockFile, isSitePath, parseDefaultLang, parseLanguages } from './format'
import { setButtons, setStatus } from './chrome'

const SAVE_DELAY = 1000
let timer: number | undefined
let queue: Promise<void> = Promise.resolve()

// Paths in the model (Hugo's default layout): blocks in content/blocks/ as NAME.md (default language) or NAME.<lang>.md,
// strings in i18n/<lang>.yaml (a single-language site uses its default language).
export const blockPath = (lang: string, name: string) => blockFile(name, lang, state.defaultLang)
export const stringsPath = (lang: string) => `i18n/${lang}.yaml`

// Languages = the [languages.<lang>] tables of hugo.toml. Default language = its defaultContentLanguage.
function detectSite(): void {
  const config = model.get(SITE_CONFIG)
  state.langs = parseLanguages(config)
  state.defaultLang = parseDefaultLang(config)
}

export async function loadModel(): Promise<void> {
  model.clear()
  state.dirty.clear()
  const paths = [...(await listFiles('content')), ...(await listFiles('i18n')), SITE_CONFIG].filter(isSitePath)
  for (const p of paths) {
    const text = await readTextOrNull(p)
    if (text !== null) model.set(p, text)
  }
  detectSite()
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

// Browser mode: replace the local site files (content/, i18n/, hugo.toml) entirely with pulled files and store the new base.
export async function replaceContent(files: Record<string, string>, meta: Meta): Promise<void> {
  clearTimeout(timer)
  state.dirty.clear()
  state.savePending = false
  for (const p of ['content', 'i18n', SITE_CONFIG]) await removePath(p)
  await inBatches(Object.keys(files), 8, (p) => writeText(p, files[p]))
  await writeMeta(meta)
  await loadModel()
  state.remoteChanged = false
}

// ---------------------------------------------------------------------------
// Edits + autosave
// ---------------------------------------------------------------------------
export function setFile(path: string, text: string): void {
  model.set(path, text)
  detectSite()
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

// Status line: unpublished changes, plus a note when GitHub has newer commits.
export async function updateStatus(): Promise<void> {
  const n = (await changedFiles()).length
  const local = state.savePending ? 'Saving…' : n ? `${n} unpublished change${n > 1 ? 's' : ''}` : 'No unpublished changes'
  setStatus(state.remoteChanged ? `${local} · Newer changes on GitHub: pull them with ↓` : local)
  setButtons({ publishEnabled: n > 0, remoteChanged: state.remoteChanged })
}
