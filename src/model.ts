// The in-memory content model: load it from disk, and derive structure from it.
import { state, model } from './state'
import type { Section, Entries } from './state'
import { resolveDir } from './disk'
import { parseFrontmatter, titleize } from './markdown'

// Load the entire content/ tree (one level of section folders) into the model.
export async function loadModel(): Promise<void> {
  model.clear()
  const content = await resolveDir(['content'])
  for await (const [name, h] of (content as any).entries() as Entries) {
    if (h.kind === 'file' && name.endsWith('.md')) {
      model.set(
        `content/${name}`,
        await (await (h as FileSystemFileHandle).getFile()).text(),
      )
    } else if (
      h.kind === 'directory' &&
      !name.startsWith('_') &&
      !name.startsWith('.')
    ) {
      for await (const [fn, fh] of (h as any).entries() as Entries) {
        if (fh.kind === 'file' && fn.endsWith('.md')) {
          model.set(
            `content/${name}/${fn}`,
            await (await (fh as FileSystemFileHandle).getFile()).text(),
          )
        }
      }
    }
  }
  state.loaded = true
}

export function scanSections(): Section[] {
  const out: Section[] = []
  for (const [path, text] of model) {
    const m = /^content\/([^/]+)\/index\.md$/.exec(path)
    if (!m) continue
    const slug = m[1]
    if (slug.startsWith('_') || slug.startsWith('.')) continue
    const fm = parseFrontmatter(text)
    out.push({
      slug,
      title: fm.title || titleize(slug),
      order: fm.order ?? Number.MAX_SAFE_INTEGER,
    })
  }
  out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  return out
}

// Every publishable route derived from the model.
export function modelRoutes(): { route: string; path: string }[] {
  const out: { route: string; path: string }[] = []
  for (const path of model.keys()) {
    let m: RegExpExecArray | null
    if (path === 'content/index.md') out.push({ route: '', path })
    else if ((m = /^content\/([^/]+)\/index\.md$/.exec(path)))
      out.push({ route: m[1], path })
    else if (
      (m = /^content\/([^/]+)\/([^/]+)\.md$/.exec(path)) &&
      m[2] !== 'index'
    )
      out.push({ route: `${m[1]}/${m[2]}`, path })
  }
  return out
}

export function slugOfPath(path: string): string {
  const m = /^content\/([^/]+)\//.exec(path)
  return m ? m[1] : ''
}

export function currentSectionSlug(): string {
  return slugOfPath(state.currentPath)
}

export function currentIsBlock(): boolean {
  return /^content\/[^/]+\/(?!index\.md$)[^/]+\.md$/.test(state.currentPath)
}
