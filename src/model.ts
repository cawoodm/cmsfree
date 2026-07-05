// The in-memory content model: load it from disk, and derive structure from it.
import { state, model } from './state'
import type { Section, Entries } from './state'
import { resolveDir } from './disk'
import { parseFrontmatter, titleize } from './markdown'

// A content/ directory that's part of the managed model. '_assets' holds
// static files (css/images/cms.js) copied verbatim by Publish, never parsed
// as content, so it's excluded. Dot-folders (.git, .DS_Store, …) are OS/tooling
// noise. Everything else — including '_'-prefixed folders like '_hidden' — is
// a real section: loaded, saved, and published, just left out of the nav (see
// scanSections). NB: a leading '_' means different things for folders and
// files — a '_folder' is a hidden Section (still published), a '_file.md' is a
// Block (never published). See classifyFile() and docs/CONCEPTS.md.
export function isManagedSectionDir(name: string): boolean {
  return name !== '_assets' && !name.startsWith('.')
}

// The domain concepts a content/ ".md" file can be, decided purely by its
// FILENAME (the segment inside a section folder, or at content/ root). This is
// the single source of truth for "what is this file?" — see docs/CONCEPTS.md.
//   index.md      → the home page, or a Section's page (published, in nav)
//   name.md       → a Page   — published, own URL, NOT in nav
//   _name.md      → a Block  — include-only; never published on its own
//   name.part.md  → a Post   — e.g. index.blog-1.md; a list item, never
//                    published on its own (surfaced only inside a list)
//   .name.md      → Hidden   — never published; reserved for later use
export type FileKind = 'index' | 'page' | 'block' | 'post' | 'hidden'

export function classifyFile(name: string): FileKind {
  if (name.startsWith('.')) return 'hidden'
  if (name.startsWith('_')) return 'block'
  const base = name.replace(/\.md$/, '')
  if (base === 'index') return 'index'
  if (base.includes('.')) return 'post' // a dot inside the name (not the ext)
  return 'page'
}

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
    } else if (h.kind === 'directory' && isManagedSectionDir(name)) {
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

// Every publishable route derived from the model: only Sections (an index.md)
// and Pages get their own URL. Blocks ('_name.md'), Posts ('name.part.md') and
// Hidden files ('.name.md') are never published on their own (see classifyFile),
// so they're excluded here.
export function modelRoutes(): { route: string; path: string }[] {
  const out: { route: string; path: string }[] = []
  for (const path of model.keys()) {
    if (path === 'content/index.md') {
      out.push({ route: '', path }) // the home page
      continue
    }
    const m = /^content\/([^/]+)\/([^/]+)\.md$/.exec(path)
    if (!m) continue
    const [, section, name] = m
    const kind = classifyFile(`${name}.md`)
    if (kind === 'index') out.push({ route: section, path })
    else if (kind === 'page') out.push({ route: `${section}/${name}`, path })
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

// True when the loaded route is a Page (a named, published, non-nav file) —
// used to show the rename/delete-page controls. Blocks, Posts, Hidden files and
// section index pages don't qualify.
export function currentIsPage(): boolean {
  const m = /^content\/[^/]+\/([^/]+)\.md$/.exec(state.currentPath)
  return !!m && classifyFile(`${m[1]}.md`) === 'page'
}
