// CRUD — all in-memory; persisted only on Save.
import { state, model } from './state'
import type { Section } from './state'
import { slugify, setFrontmatterTitle, parseFrontmatter } from './markdown'
import { scanSections, currentSectionSlug } from './model'
import { currentRoute } from './routes'
import { markDirty } from './save'
import { setStatus } from './chrome'
import { renderNav, renderCurrent } from './view'
import { renderRoute } from './router'

export function createSection(): void {
  const name = prompt('New section name:')
  if (!name) return
  const slug = slugify(name)
  if (!slug)
    return void setStatus('That name has no usable slug — try letters/numbers.')
  if (scanSections().some((s) => s.slug === slug))
    return void setStatus(`A section "${slug}" already exists.`)
  const order = scanSections().length + 1
  model.set(
    `content/${slug}/index.md`,
    `---\ntitle: ${name}\nslug: ${slug}\norder: ${order}\n---\n\n# ${name}\n\nNew section — edit me.\n`,
  )
  markDirty()
  renderNav()
  location.hash = '#/' + slug
  setStatus(
    `Added section "${name}" (unsaved). Click Save to write it to disk.`,
  )
}

export function renameSection(s: Section): void {
  const input = prompt('Rename section:', s.title)
  if (!input) return
  const newSlug = slugify(input)
  if (!newSlug) return void setStatus('That name has no usable slug.')
  if (newSlug === s.slug) {
    const p = `content/${s.slug}/index.md`
    const t = model.get(p)
    if (t !== undefined) model.set(p, setFrontmatterTitle(t, input))
  } else {
    if (scanSections().some((x) => x.slug === newSlug))
      return void setStatus(`A section "${newSlug}" already exists.`)
    const pre = `content/${s.slug}/`
    for (const [path, text] of [...model]) {
      if (!path.startsWith(pre)) continue
      const rest = path.slice(pre.length)
      model.set(
        `content/${newSlug}/${rest}`,
        rest === 'index.md' ? setFrontmatterTitle(text, input) : text,
      )
      model.delete(path)
    }
  }
  markDirty()
  renderNav()
  location.hash = '#/' + newSlug
  setStatus(
    `Renamed to "${input}" (unsaved). Links using the old name may need updating.`,
  )
}

export function deleteSection(s: Section): void {
  if (
    !confirm(
      `Delete section "${s.title}" and everything inside it? This cannot be undone.`,
    )
  )
    return
  for (const path of [...model.keys()])
    if (path.startsWith(`content/${s.slug}/`)) model.delete(path)
  markDirty()
  renderNav()
  if (currentSectionSlug() === s.slug || currentRoute() === s.slug)
    location.hash = '#/'
  else renderRoute()
  setStatus(`Deleted section "${s.title}" (unsaved).`)
}

// A "block" here is an unlisted PAGE (its own route/file, just out of the
// nav) — for content concatenated into an existing page with no page of its
// own, see createFragment() below.
export function createBlock(): void {
  const section = currentSectionSlug() || currentRoute()
  if (!section)
    return void setStatus('Open a section first, then add a block to it.')
  const name = prompt('New block name (an unlisted page in this section):')
  if (!name) return
  const slug = slugify(name)
  if (!slug || slug === 'index') return void setStatus('Pick a different name.')
  const path = `content/${section}/${slug}.md`
  if (model.has(path))
    return void setStatus(`A block "${slug}" already exists in this section.`)
  model.set(
    path,
    `---\ntitle: ${name}\nslug: ${slug}\n---\n\n# ${name}\n\nNew block. Link to it from content with \`[${name}](#/${section}/${slug})\`.\n`,
  )
  markDirty()
  location.hash = `#/${section}/${slug}`
  setStatus(
    `Added block "${name}" (unsaved). It's unlisted — link to it from a page.`,
  )
}

// Add a fragment: content concatenated into the CURRENT page via
// [include](_slug.md), with no page/route of its own — unlike createBlock()
// above, which creates an unlisted PAGE. Fragments are sibling files in the
// current page's section folder, named with a leading underscore so
// modelRoutes() skips them (see model.ts).
export function createFragment(): void {
  const section = currentSectionSlug()
  if (!section)
    return void setStatus(
      'Fragments need a section folder — open a section page first.',
    )
  const name = prompt('New fragment name (content added to this page):')
  if (!name) return
  const slug = slugify(name)
  if (!slug) return void setStatus('That name has no usable slug.')
  const fileName = `_${slug}.md`
  const path = `content/${section}/${fileName}`
  if (model.has(path))
    return void setStatus(`A fragment "${slug}" already exists in this section.`)
  model.set(
    path,
    `---\ntitle: ${name}\n---\n\n# ${name}\n\nNew fragment — edit me.\n`,
  )
  const directive = `[include](${fileName})`
  const sep = state.currentText.endsWith('\n') ? '\n' : '\n\n'
  const newText = state.currentText + sep + directive + '\n'
  model.set(state.currentPath, newText)
  state.currentText = newText
  markDirty()
  renderCurrent()
  setStatus(
    `Added fragment "${name}" to this page (unsaved). Click Save to write it to disk.`,
  )
}

export function renameBlock(): void {
  const section = currentSectionSlug()
  const input = prompt(
    'Rename block:',
    parseFrontmatter(state.currentText).title || '',
  )
  if (!input) return
  const newSlug = slugify(input)
  if (!newSlug || newSlug === 'index')
    return void setStatus('Pick a different name.')
  const newPath = `content/${section}/${newSlug}.md`
  if (newPath !== state.currentPath && model.has(newPath))
    return void setStatus(`A block "${newSlug}" already exists.`)
  model.set(newPath, setFrontmatterTitle(state.currentText, input))
  if (newPath !== state.currentPath) model.delete(state.currentPath)
  markDirty()
  const target = `#/${section}/${newSlug}`
  if (location.hash === target) renderRoute()
  else location.hash = target
  setStatus(`Renamed block to "${input}" (unsaved).`)
}

export function deleteBlock(): void {
  const section = currentSectionSlug()
  const title = parseFrontmatter(state.currentText).title || state.currentPath
  if (!confirm(`Delete block "${title}"? This cannot be undone.`)) return
  model.delete(state.currentPath)
  markDirty()
  location.hash = '#/' + section
  setStatus(`Deleted block "${title}" (unsaved).`)
}
