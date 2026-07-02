// Save — the ONLY path that touches disk. Full-sync: write every model file,
// regenerate the manifest, prune disk entries no longer in the model, and bump
// content/version.json exactly once.
import { state, model, VERSION_PATH } from './state'
import type { Entries } from './state'
import { resolveDir, readFile, writeFile, verifyPermission } from './disk'
import { scanSections, isManagedSectionDir } from './model'
import { setStatus, updateSaveButton } from './chrome'

export function markDirty(): void {
  state.dirty = true
  updateSaveButton()
}

async function pruneDisk(): Promise<void> {
  const content = await resolveDir(['content'])
  const paths = new Set(model.keys())
  const slugs = new Set<string>()
  for (const p of model.keys()) {
    const m = /^content\/([^/]+)\//.exec(p)
    if (m) slugs.add(m[1])
  }
  for await (const [name, h] of (content as any).entries() as Entries) {
    if (h.kind === 'file') {
      if (name.endsWith('.md') && !paths.has(`content/${name}`))
        await content.removeEntry(name)
    } else if (h.kind === 'directory' && isManagedSectionDir(name)) {
      if (!slugs.has(name)) {
        await content.removeEntry(name, { recursive: true }) // whole section removed
      } else {
        for await (const [fn, fh] of (h as any).entries() as Entries) {
          if (
            fh.kind === 'file' &&
            fn.endsWith('.md') &&
            !paths.has(`content/${name}/${fn}`)
          ) {
            await (h as any).removeEntry(fn)
          }
        }
      }
    }
  }
}

async function bumpContentVersion(): Promise<void> {
  let n = 0
  try {
    n = JSON.parse(await readFile(VERSION_PATH)).version ?? 0
  } catch {
    n = 0 // missing/malformed → start fresh
  }
  await writeFile(
    VERSION_PATH,
    JSON.stringify(
      { version: n + 1, updated: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  )
}

export async function saveAll(): Promise<void> {
  if (!state.dirty) return
  if (!state.dirHandle || !(await verifyPermission(state.dirHandle, true))) {
    setStatus('Save needs folder access.', 'Reconnect', () => location.reload())
    return
  }
  const save = document.querySelector(
    '#cms-banner .cms-save',
  ) as HTMLButtonElement | null
  if (save) {
    save.disabled = true
    save.textContent = 'Saving…'
  }
  try {
    for (const [path, text] of model) await writeFile(path, text)
    await writeFile(
      'content/manifest.json',
      JSON.stringify(scanSections(), null, 2) + '\n',
    )
    await pruneDisk()
    await bumpContentVersion()
    state.dirty = false
    updateSaveButton()
    setStatus('Saved all changes to content/. Publish to make it live.')
  } catch (err) {
    updateSaveButton()
    setStatus(
      'Save failed: ' +
        (err as Error).message +
        ' — your changes are still in memory.',
    )
  }
}
