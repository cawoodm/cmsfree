// cmsfree engine — build target: a single self-contained `cms.js`.
//
// Content-agnostic: this bundle knows nothing about any specific site's
// content/ or publish/. It activates only when the URL carries `?edit`, then
// connects (via the File System Access API) to the SITE ROOT — the directory
// that contains both `content/` (the editable markdown source) and `publish/`
// (the generated static site).
//
// Editing model: on connect, the entire content/ tree is read into an
// in-memory model. ALL edits — page text and structural create/rename/delete —
// mutate the in-memory model only. Nothing is written to disk, and no version
// is bumped, until the user clicks the global Save button, which flushes the
// whole model to disk in one pass and bumps content/version.json once.

import { marked } from 'marked'

// ---- FSA type shims (permission methods aren't in the standard DOM lib) ----
type Perm = 'granted' | 'denied' | 'prompt'
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>
}
type Entries = AsyncIterable<[string, FileSystemHandle]>
declare global {
  interface Window {
    showDirectoryPicker(o?: { mode?: 'read' | 'readwrite' }): Promise<DirHandle>
  }
}

const VERSION_PATH = 'content/version.json'

interface Section {
  slug: string
  title: string
  order: number
}

// ---- Module state ----
let dirHandle: DirHandle | null = null
let connected = false
let dirty = false
const model = new Map<string, string>() // content-relative path -> raw file text
let loaded = false
let currentText = '' // raw text (frontmatter + body) of the loaded route
let currentPath = '' // content-relative path of the loaded route

// ---------------------------------------------------------------------------
// Edit-mode detection
// ---------------------------------------------------------------------------
function isEditMode(): boolean {
  return new URLSearchParams(location.search).has('edit')
}

// ---------------------------------------------------------------------------
// Top edit bar — persistent chrome with status + Save. Never fail silently.
//   [ status message ] [ transient action ] .......... [ Save ]
// ---------------------------------------------------------------------------
function ensureBar(): HTMLElement {
  let bar = document.getElementById('cms-banner')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'cms-banner'
    const msg = document.createElement('span')
    msg.className = 'cms-msg'
    const actions = document.createElement('span')
    actions.className = 'cms-actions'
    const spacer = document.createElement('span')
    spacer.className = 'cms-spacer'
    const save = document.createElement('button')
    save.className = 'cms-save'
    save.type = 'button'
    save.textContent = 'Save'
    save.style.display = 'none'
    save.addEventListener('click', () => void saveAll())
    const publish = document.createElement('button')
    publish.className = 'cms-publish'
    publish.type = 'button'
    publish.textContent = 'Publish'
    publish.style.display = 'none'
    publish.addEventListener('click', () => void publishSite())
    bar.append(msg, actions, spacer, save, publish)
    document.body.prepend(bar)
  }
  return bar
}

// Set the status message (+ optional inline action button). Leaves Save intact.
function setStatus(
  message: string,
  actionLabel?: string,
  onAction?: () => void,
): void {
  const bar = ensureBar()
  bar.style.display = 'flex'
  ;(bar.querySelector('.cms-msg') as HTMLElement).textContent = message
  const actions = bar.querySelector('.cms-actions') as HTMLElement
  actions.innerHTML = ''
  if (actionLabel && onAction) {
    const b = document.createElement('button')
    b.className = 'cms-banner-btn'
    b.textContent = actionLabel
    b.addEventListener('click', onAction)
    actions.append(b)
  }
}

function updateSaveButton(): void {
  const bar = ensureBar() // create the bar if it doesn't exist yet
  const save = bar.querySelector('.cms-save') as HTMLButtonElement
  save.style.display = connected ? 'inline-block' : 'none'
  save.disabled = !dirty
  save.textContent = dirty ? 'Save' : 'Saved'
  const publish = bar.querySelector('.cms-publish') as HTMLButtonElement
  publish.style.display = connected ? 'inline-block' : 'none'
}

// ---------------------------------------------------------------------------
// Publish — generate the static publish/ site from the model. Auto-saves first
// (so content/ is current), pre-renders one HTML file per route from the shell
// template, and syncs publish/version.json to content/version.json.
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )
}

// Published URL for a route (real static links, not hash routes).
function routeToUrl(route: string): string {
  if (route === '') return '/'
  const segs = route.split('/')
  return segs.length === 1 ? `/${segs[0]}/` : `/${segs[0]}/${segs[1]}.html`
}

// Output file for a route within the site root.
function routeToOutPath(route: string): string {
  if (route === '') return 'publish/index.html'
  const segs = route.split('/')
  return segs.length === 1
    ? `publish/${segs[0]}/index.html`
    : `publish/${segs[0]}/${segs[1]}.html`
}

// Every publishable route derived from the model.
function modelRoutes(): { route: string; path: string }[] {
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

function buildNavHtml(sections: Section[], route: string): string {
  const items = sections
    .map(
      (s) =>
        `<li><a href="${routeToUrl(s.slug)}"${route === s.slug ? ' class="active"' : ''}>${escapeHtml(s.title)}</a></li>`,
    )
    .join('')
  return `<ul>${items}</ul>`
}

// Render one static page from the shell template.
function buildPage(
  template: string,
  opts: {
    title: string
    navHtml: string
    contentHtml: string
    isHome: boolean
  },
): string {
  const doc = new DOMParser().parseFromString(template, 'text/html')
  const titleEl = doc.querySelector('title')
  if (titleEl) titleEl.textContent = opts.title
  const navHost = doc.querySelector('[x-cms-nav]')
  if (navHost) navHost.innerHTML = opts.navHtml
  const contentHost = doc.querySelector('[x-cms-content]')
  if (contentHost) contentHost.innerHTML = opts.contentHtml
  if (!opts.isHome)
    doc.querySelectorAll('[data-cms-home-only]').forEach((el) => el.remove())
  // Turn hash routes (#/about-us) into real static links everywhere in the doc.
  doc.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]').forEach((a) => {
    a.setAttribute(
      'href',
      routeToUrl(a.getAttribute('href')!.slice(2).replace(/\/$/, '')),
    )
  })
  // Root-absolute the relative asset paths so they resolve at any page depth.
  doc.querySelectorAll('[src],[href]').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href'
    const v = el.getAttribute(attr) || ''
    if (v === '' || /^(https?:|mailto:|tel:|#|\/)/i.test(v)) return
    el.setAttribute(attr, '/' + v)
  })
  let html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
  // The dormant sleeper: comment placeholder → production script.
  return html.replace(
    /<!--\s*cms:entry\s*-->/g,
    '<script src="/cms.js"></script>',
  )
}

async function publishSite(): Promise<void> {
  if (!dirHandle) return void setStatus('Connect a folder first.')
  if (dirty) {
    setStatus('Saving before publish…')
    await saveAll()
    if (dirty) return // save failed — saveAll already reported why
  }
  if (!(await verifyPermission(dirHandle, true))) {
    return void setStatus('Publish needs folder access.', 'Reconnect', () =>
      location.reload(),
    )
  }
  const btn = document.querySelector(
    '#cms-banner .cms-publish',
  ) as HTMLButtonElement | null
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Publishing…'
  }
  try {
    const template = await readFile('publish/index.html')
    const sections = scanSections()
    const routes = modelRoutes()
    for (const { route, path } of routes) {
      const text = model.get(path)!
      const { body } = splitFrontmatter(text)
      const title =
        parseFrontmatter(text).title ||
        (route === '' ? 'Home' : titleize(route.split('/').pop()!))
      const html = buildPage(template, {
        title,
        navHtml: buildNavHtml(sections, route.includes('/') ? '' : route),
        contentHtml: marked.parse(body) as string,
        isHome: route === '',
      })
      await writeFile(routeToOutPath(route), html)
    }
    // Sync publish version to the (just-saved) content version.
    let v = 0
    try {
      v = JSON.parse(await readFile(VERSION_PATH)).version ?? 0
    } catch {
      /* keep 0 */
    }
    await writeFile(
      'publish/version.json',
      JSON.stringify(
        { version: v, updated: new Date().toISOString() },
        null,
        2,
      ) + '\n',
    )
    setStatus(
      `Published ${routes.length} page(s) to publish/ (version ${v}). Deploy the publish/ folder to go live.`,
    )
  } catch (err) {
    setStatus('Publish failed: ' + (err as Error).message)
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Publish'
    }
  }
}

function markDirty(): void {
  dirty = true
  updateSaveButton()
}

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

async function idbGetHandle(): Promise<DirHandle | undefined> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY)
    req.onsuccess = () => resolve(req.result as DirHandle | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSetHandle(handle: DirHandle): Promise<void> {
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
async function verifyPermission(
  handle: DirHandle,
  request: boolean,
): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if (request && (await handle.requestPermission(opts)) === 'granted')
    return true
  return false
}

async function connectDirectory(): Promise<DirHandle> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await idbSetHandle(handle)
  dirHandle = handle
  return handle
}

// Ensures dirHandle is usable. Restores a stored handle (re-granting permission
// via a user gesture), or shows a persistent Connect prompt. Never silently
// falls back to read-only while ?edit is set.
async function ensureConnected(): Promise<boolean> {
  if (dirHandle && (await verifyPermission(dirHandle, false))) return true

  const stored = await idbGetHandle()
  if (stored) {
    if (await verifyPermission(stored, false)) {
      dirHandle = stored
      return true
    }
    // Permission can't be re-granted silently after reload — needs a gesture.
    return new Promise((resolve) => {
      setStatus('Reconnect to continue editing.', 'Reconnect', async () => {
        if (await verifyPermission(stored, true)) {
          dirHandle = stored
          resolve(true)
        } else {
          setStatus(
            'Permission denied. Editing needs folder access.',
            'Try again',
            () => location.reload(),
          )
          resolve(false)
        }
      })
    })
  }

  return new Promise((resolve) => {
    setStatus(
      'Connect your site folder to start editing.',
      'Connect folder',
      async () => {
        try {
          await connectDirectory()
          resolve(true)
        } catch {
          setStatus(
            'Folder not connected. Editing needs folder access.',
            'Connect folder',
            () => location.reload(),
          )
          resolve(false)
        }
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Raw disk I/O (paths relative to the connected site root). Used only by
// loadModel (reads) and saveAll (writes). Permission is checked once per save.
// ---------------------------------------------------------------------------
async function resolveDir(
  parts: string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let dir: FileSystemDirectoryHandle = dirHandle!
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

async function readFile(relPath: string): Promise<string> {
  const parts = relPath.split('/')
  const fileName = parts.pop()!
  const dir = await resolveDir(parts)
  const fh = await dir.getFileHandle(fileName)
  return (await fh.getFile()).text()
}

async function writeFile(relPath: string, text: string): Promise<void> {
  const parts = relPath.split('/')
  const fileName = parts.pop()!
  const dir = await resolveDir(parts, true)
  const fh = await dir.getFileHandle(fileName, { create: true })
  const w = await fh.createWritable()
  await w.write(text)
  await w.close()
}

// Load the entire content/ tree (one level of section folders) into the model.
async function loadModel(): Promise<void> {
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
  loaded = true
}

// ---------------------------------------------------------------------------
// Save — the ONLY path that touches disk. Full-sync: write every model file,
// regenerate the manifest, prune disk entries no longer in the model, and bump
// content/version.json exactly once.
// ---------------------------------------------------------------------------
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
    } else if (
      h.kind === 'directory' &&
      !name.startsWith('_') &&
      !name.startsWith('.')
    ) {
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

async function saveAll(): Promise<void> {
  if (!dirty) return
  if (!dirHandle || !(await verifyPermission(dirHandle, true))) {
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
    dirty = false
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

// ---------------------------------------------------------------------------
// Markdown + frontmatter
// ---------------------------------------------------------------------------
function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  if (!m) return { frontmatter: '', body: text }
  return { frontmatter: m[0], body: text.slice(m[0].length) }
}

function parseFrontmatter(text: string): { title?: string; order?: number } {
  const { frontmatter } = splitFrontmatter(text)
  const out: { title?: string; order?: number } = {}
  const t = /^title:\s*(.+)$/m.exec(frontmatter)
  if (t) out.title = t[1].trim().replace(/^["']|["']$/g, '')
  const o = /^order:\s*(\d+)$/m.exec(frontmatter)
  if (o) out.order = Number(o[1])
  return out
}

function setFrontmatterTitle(text: string, title: string): string {
  const { frontmatter, body } = splitFrontmatter(text)
  if (frontmatter) {
    if (/^title:.*$/m.test(frontmatter))
      return frontmatter.replace(/^title:.*$/m, `title: ${title}`) + body
    return frontmatter.replace(/^---\r?\n/, `---\ntitle: ${title}\n`) + body
  }
  return `---\ntitle: ${title}\n---\n\n` + text
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function titleize(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function contentEl(): HTMLElement | null {
  return document.querySelector('[x-cms-content]')
}

function renderCurrent(): void {
  const el = contentEl()
  if (!el) return
  const { body } = splitFrontmatter(currentText)
  el.innerHTML = marked.parse(body) as string
  addEditAffordance()
}

// ---------------------------------------------------------------------------
// Structure derived from the in-memory model
// ---------------------------------------------------------------------------
function scanSections(): Section[] {
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

function currentSectionSlug(): string {
  const m = /^content\/([^/]+)\//.exec(currentPath)
  return m ? m[1] : ''
}

function currentIsBlock(): boolean {
  return /^content\/[^/]+\/(?!index\.md$)[^/]+\.md$/.test(currentPath)
}

// ---------------------------------------------------------------------------
// Nav generation (EDIT MODE) — rebuilt from the model. Home is reached via the
// shell logo, not a nav item.
// ---------------------------------------------------------------------------
function navControl(
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

function renderNav(): void {
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

// ---------------------------------------------------------------------------
// CRUD — all in-memory; persisted only on Save
// ---------------------------------------------------------------------------
function createSection(): void {
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
    `---\ntitle: ${name}\norder: ${order}\n---\n\n# ${name}\n\nNew section — edit me.\n`,
  )
  markDirty()
  renderNav()
  location.hash = '#/' + slug
  setStatus(
    `Added section "${name}" (unsaved). Click Save to write it to disk.`,
  )
}

function renameSection(s: Section): void {
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

function deleteSection(s: Section): void {
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

function createBlock(): void {
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
    `---\ntitle: ${name}\n---\n\n# ${name}\n\nNew block. Link to it from content with \`[${name}](#/${section}/${slug})\`.\n`,
  )
  markDirty()
  location.hash = `#/${section}/${slug}`
  setStatus(
    `Added block "${name}" (unsaved). It's unlisted — link to it from a page.`,
  )
}

function renameBlock(): void {
  const section = currentSectionSlug()
  const input = prompt(
    'Rename block:',
    parseFrontmatter(currentText).title || '',
  )
  if (!input) return
  const newSlug = slugify(input)
  if (!newSlug || newSlug === 'index')
    return void setStatus('Pick a different name.')
  const newPath = `content/${section}/${newSlug}.md`
  if (newPath !== currentPath && model.has(newPath))
    return void setStatus(`A block "${newSlug}" already exists.`)
  model.set(newPath, setFrontmatterTitle(currentText, input))
  if (newPath !== currentPath) model.delete(currentPath)
  markDirty()
  const target = `#/${section}/${newSlug}`
  if (location.hash === target) renderRoute()
  else location.hash = target
  setStatus(`Renamed block to "${input}" (unsaved).`)
}

function deleteBlock(): void {
  const section = currentSectionSlug()
  const title = parseFrontmatter(currentText).title || currentPath
  if (!confirm(`Delete block "${title}"? This cannot be undone.`)) return
  model.delete(currentPath)
  markDirty()
  location.hash = '#/' + section
  setStatus(`Deleted block "${title}" (unsaved).`)
}

// ---------------------------------------------------------------------------
// Editing UI — content toolbar + source editor (memory only; disk on Save)
// ---------------------------------------------------------------------------
function addEditAffordance(): void {
  const el = contentEl()
  if (!el || el.querySelector('.cms-toolbar')) return
  const bar = document.createElement('div')
  bar.className = 'cms-toolbar'

  const pencil = document.createElement('button')
  pencil.className = 'cms-edit-icon'
  pencil.type = 'button'
  pencil.title = 'Edit this page'
  pencil.textContent = '✎'
  pencil.addEventListener('click', openEditor)
  bar.append(pencil)

  const section = currentSectionSlug() || currentRoute()
  if (section)
    bar.append(
      navControl('＋ block', 'Add a block to this section', () =>
        createBlock(),
      ),
    )
  if (currentIsBlock()) {
    bar.append(
      navControl('✎ name', 'Rename this block', () => renameBlock()),
      navControl('🗑 block', 'Delete this block', () => deleteBlock()),
    )
  }
  el.prepend(bar)
}

function openEditor(): void {
  const el = contentEl()
  if (!el) return
  el.innerHTML = ''

  const textarea = document.createElement('textarea')
  textarea.className = 'cms-editor'
  textarea.value = currentText

  const actions = document.createElement('div')
  actions.className = 'cms-editor-actions'
  const applyBtn = document.createElement('button')
  applyBtn.className = 'cms-btn cms-btn-save'
  applyBtn.textContent = 'OK'
  applyBtn.title = 'Confirm this edit (use Save at the top to write to disk)'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'cms-btn cms-btn-cancel'
  cancelBtn.textContent = 'Cancel'
  applyBtn.addEventListener('click', () => closeEditor(true, textarea.value))
  cancelBtn.addEventListener('click', () => closeEditor(false))

  actions.append(applyBtn, cancelBtn)
  el.append(textarea, actions)
  textarea.focus()
}

function closeEditor(apply: boolean, newText?: string): void {
  if (apply && newText !== undefined) {
    model.set(currentPath, newText)
    currentText = newText
    markDirty()
    if (currentPath.endsWith('/index.md')) renderNav() // title/order may have changed
    setStatus(
      'Applied to ' + currentPath + ' (unsaved). Click Save to write to disk.',
    )
  }
  renderCurrent()
}

// ---------------------------------------------------------------------------
// Router (EDIT MODE ONLY) — in-memory hash routing over the model.
//   ''                      → content/index.md
//   'about-us'              → content/about-us/index.md
//   'services/custom-cakes' → content/services/custom-cakes.md
// ---------------------------------------------------------------------------
function routeToPath(route: string): string {
  if (route === '') return 'content/index.md'
  const segs = route.split('/')
  if (segs.length === 1) return `content/${segs[0]}/index.md`
  return `content/${segs.join('/')}.md`
}

function routeFromAnchor(a: HTMLAnchorElement): string | null {
  const raw = a.getAttribute('href') || ''
  if (raw.startsWith('#/')) return raw.slice(2).replace(/\/$/, '')
  if (/^([a-z]+:)?\/\//i.test(raw) || /^(mailto:|tel:)/i.test(raw)) return null
  if (raw.startsWith('/')) {
    const r = raw
      .replace(/^\/+/, '')
      .replace(/\/$/, '')
      .replace(/\.html$/, '')
    if (/^(images|css|js)\//.test(r)) return null
    return r === 'index' || r === '' ? '' : r
  }
  return null
}

function currentRoute(): string {
  return location.hash.replace(/^#\/?/, '').replace(/\/$/, '')
}

function updateActiveNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[x-cms-nav] a').forEach((a) => {
    const r = routeFromAnchor(a)
    a.classList.toggle('active', r !== null && r === route)
  })
}

function renderRoute(): void {
  if (!loaded) return
  const route = currentRoute()
  const path = routeToPath(route)
  const text = model.get(path)
  if (text === undefined) {
    const el = contentEl()
    if (el)
      el.innerHTML = `<p>No content at <code>${path}</code>. It may have been deleted or not yet created.</p>`
    setStatus(`No content at ${path}.`)
    updateActiveNav(route)
    return
  }
  currentText = text
  currentPath = path
  renderCurrent()
  updateActiveNav(route)
}

function onNavClick(e: MouseEvent): void {
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey
  )
    return
  const a = (e.target as Element).closest('a')
  if (!a) return
  const route = routeFromAnchor(a as HTMLAnchorElement)
  if (route === null) return // external/asset → browser handles it
  e.preventDefault()
  const target = '#/' + route
  if (location.hash === target) renderRoute()
  else location.hash = target // triggers hashchange → renderRoute
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  if (!isEditMode()) return // dormant in view mode
  setStatus('cmsfree — connecting…') // show the edit bar immediately
  const ok = await ensureConnected()
  if (!ok) return
  connected = true
  await loadModel()
  setStatus('Connected. Edits stay in memory until you Save.')
  updateSaveButton() // now that we're connected, reveal Save + Publish
  document.addEventListener('click', onNavClick)
  window.addEventListener('hashchange', () => renderRoute())
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault()
      e.returnValue = '' // prompt before losing unsaved in-memory edits
    }
  })
  renderNav()
  renderRoute()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  void boot()
}

if (import.meta.hot) import.meta.hot.accept()

export { isEditMode }
