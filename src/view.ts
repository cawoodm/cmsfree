// DOM rendering from the in-memory model: the template shell, the current
// page's content, and the generated section nav.
import { state } from './state'
import { readFile } from './disk'
import { rewriteAssetRefs } from './assets'
import { splitFrontmatter } from './markdown'
import { renderBody, applyTemplateBlocks } from './content'
import { scanSections, currentSectionSlug } from './model'
import { currentRoute } from './routes'
import { addEditAffordance } from './editor'
import { createSection, renameSection, deleteSection } from './crud'

export function contentEl(): HTMLElement | null {
  return document.querySelector('[x-cms-content]')
}

// EDIT MODE: rebuild the page from the on-disk template (read via FSA), so the
// dev/static server never has to serve content/. Preserves the live <head>
// (running module + HMR client); adds the template's stylesheets/title.
export async function applyTemplateShell(): Promise<void> {
  const doc = new DOMParser().parseFromString(
    await readFile('content/template.html'),
    'text/html',
  )
  const have = new Set(
    [...document.head.querySelectorAll('link')].map((l) =>
      l.getAttribute('href'),
    ),
  )
  doc.head.querySelectorAll('link').forEach((l) => {
    if (!have.has(l.getAttribute('href')))
      document.head.appendChild(document.importNode(l, true))
  })
  if (doc.title) document.title = doc.title
  document.body.replaceWith(document.importNode(doc.body, true))
  rewriteAssetRefs(document) // point css/images/favicon at blob URLs (from disk)
  applyTemplateBlocks(document) // fill x-cms-block="_name.md" placeholders (e.g. footer)
}

export function renderCurrent(): void {
  const el = contentEl()
  if (!el) return
  const { body } = splitFrontmatter(state.currentText)
  el.innerHTML = renderBody(body, currentSectionSlug(), state.currentPath)
  rewriteAssetRefs(el) // markdown-referenced images load from disk too
  addEditAffordance()
}

// ---------------------------------------------------------------------------
// Nav generation (EDIT MODE) — rebuilt from the model. Home is reached via the
// shell logo, not a nav item.
// ---------------------------------------------------------------------------
export function navControl(
  symbol: string,
  title: string,
  onClick: () => void,
): HTMLElement {
  const b = document.createElement('button')
  b.className = 'cms-nav-ctl'
  b.type = 'button'
  b.title = title
  b.textContent = symbol
  b.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return b
}

export function renderNav(): void {
  const host = document.querySelector('[x-cms-nav]')
  if (!host) return
  const route = currentRoute()
  const ul = document.createElement('ul')
  for (const s of scanSections()) {
    const li = document.createElement('li')
    li.className = 'cms-nav-item'
    const a = document.createElement('a')
    a.href = '#/' + s.slug
    a.textContent = s.title
    if (route === s.slug) a.classList.add('active')
    li.append(
      a,
      navControl('✎', 'Rename section', () => renameSection(s)),
      navControl('🗑', 'Delete section', () => deleteSection(s)),
    )
    ul.append(li)
  }
  const addLi = document.createElement('li')
  addLi.className = 'cms-nav-item'
  addLi.append(navControl('＋', 'New section', () => createSection()))
  ul.append(addLi)
  host.innerHTML = ''
  host.append(ul)
}
