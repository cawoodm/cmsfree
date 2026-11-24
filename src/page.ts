// Binds the live page to the model: finds the <!--cms:KEY-->…<!--/cms--> ranges,
// overlays edit pencils, opens the editor and Texts dialogs, and re-renders ranges.
import { model, state } from './state'
import { isBlockKey, isMarkerClose, markerKey, parseStrings, renderKeyHtml, setString, splitKey } from './format'
import { dialog } from './chrome'
import { setFile } from './store'

interface Rng {
  key: string
  start: Comment
  end: Comment
}

let ranges: Rng[] = []
let overlay: HTMLElement | null = null
const pencils = new Map<Rng, HTMLButtonElement>()

// ---------------------------------------------------------------------------
// Content lookup (page language first, then the fallback language)
// ---------------------------------------------------------------------------
const blockPath = (lang: string, name: string) => `content/${lang}/${name}`
const yamlPath = (lang: string) => `content/${lang}/site.yml`

function stringsOf(lang: string): Record<string, string> {
  return parseStrings(model.get(yamlPath(lang)) ?? '')
}

// The source text for a key and whether it came from the fallback language.
function lookup(key: string): { text: string; fallback: boolean } | null {
  const { name } = splitKey(key)
  const own = isBlockKey(key) ? model.get(blockPath(state.lang, name)) : stringsOf(state.lang)[key]
  if (own !== undefined) return { text: own, fallback: false }
  if (state.fallbackLang === state.lang) return null
  const fb = isBlockKey(key) ? model.get(blockPath(state.fallbackLang, name)) : stringsOf(state.fallbackLang)[key]
  return fb === undefined ? null : { text: fb, fallback: true }
}

// Page language = <html lang>; unknown languages fall back to the first language folder.
export function initLanguage(): void {
  const wanted = document.documentElement.lang
  state.lang = state.languages.includes(wanted) ? wanted : state.fallbackLang
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------
// Pairs each cms:KEY comment with the next /cms comment that has the same parent.
function scan(): void {
  ranges = []
  const open = new Map<Node, Comment>()
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const c = n as Comment
    const parent = c.parentNode!
    if (markerKey(c.data) !== null) open.set(parent, c)
    else if (isMarkerClose(c.data) && open.has(parent)) {
      const start = open.get(parent)!
      ranges.push({ key: markerKey(start.data)!, start, end: c })
      open.delete(parent)
    }
  }
}

function domRange(r: Rng): Range {
  const range = document.createRange()
  range.setStartAfter(r.start)
  range.setEndBefore(r.end)
  return range
}

// Replaces what sits between the markers; parsed via <template> so <li> works.
function render(r: Rng): void {
  const found = lookup(r.key)
  if (!found) return
  while (r.start.nextSibling && r.start.nextSibling !== r.end) r.start.nextSibling.remove()
  const tpl = document.createElement('template')
  try {
    tpl.innerHTML = renderKeyHtml(r.key, found.text)
  } catch (err) {
    tpl.innerHTML = ''
    console.warn('cmsfree: cannot render ' + r.key, err)
  }
  r.end.parentNode!.insertBefore(tpl.content, r.end)
}

function renderName(name: string): void {
  for (const r of ranges) if (splitKey(r.key).name === name) render(r)
  placePencils()
}

// Re-render every range (after a pull replaced the content).
export function renderAll(): void {
  for (const r of ranges) render(r)
  placePencils()
}

// ---------------------------------------------------------------------------
// Pencils
// ---------------------------------------------------------------------------
function buildPencils(): void {
  overlay?.remove()
  pencils.clear()
  overlay = document.createElement('div')
  overlay.className = 'cms-overlay'
  for (const r of ranges.filter((x) => isBlockKey(x.key))) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cms-pencil'
    b.textContent = '✎'
    b.title = 'Edit ' + splitKey(r.key).name
    b.addEventListener('click', () => openEditor(r.key))
    overlay.append(b)
    pencils.set(r, b)
  }
  document.body.append(overlay)
}

// Positions each pencil at the top-right of its range, in document coordinates; hidden when the range is not visible.
function placePencils(): void {
  for (const [r, b] of pencils) {
    const rect = domRange(r).getBoundingClientRect()
    if (!rect.width && !rect.height) {
      b.style.display = 'none'
      continue
    }
    b.style.display = ''
    b.style.left = `${Math.round(rect.right + window.scrollX - 30)}px`
    b.style.top = `${Math.round(rect.top + window.scrollY + 4)}px`
  }
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------
export function openEditor(key: string): void {
  const { name } = splitKey(key)
  const block = isBlockKey(key)
  const found = lookup(key)
  const d = dialog()
  d.innerHTML = `
    <h2></h2>
    <p class="cms-note" hidden></p>
    <textarea spellcheck="true"></textarea>
    <div class="cms-row">
      <button type="button" class="cms-btn cms-cancel">Cancel</button>
      <button type="button" class="cms-btn cms-primary cms-ok">OK</button>
    </div>`
  ;(d.querySelector('h2') as HTMLElement).textContent = `${name} (${state.lang})`
  const note = d.querySelector('.cms-note') as HTMLElement
  if (!found || found.fallback) {
    note.hidden = false
    note.textContent = block
      ? `No ${state.lang} text yet. OK creates ${blockPath(state.lang, name)}.`
      : `No ${state.lang} text yet. OK adds "${key}" to ${yamlPath(state.lang)}.`
  }
  const area = d.querySelector('textarea') as HTMLTextAreaElement
  area.value = found?.text ?? ''
  if (!block) area.style.minHeight = '8em'
  const ok = () => {
    if (area.value !== (found?.text ?? '') || found?.fallback) apply(key, area.value)
    d.close()
  }
  d.querySelector('.cms-ok')!.addEventListener('click', ok)
  d.querySelector('.cms-cancel')!.addEventListener('click', () => d.close())
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      ok()
    }
  })
  d.showModal()
  area.focus()
}

// Writes the new text to the model (autosave follows) and re-renders the page.
function apply(key: string, text: string): void {
  const { name } = splitKey(key)
  if (isBlockKey(key)) setFile(blockPath(state.lang, name), text)
  else setFile(yamlPath(state.lang), setString(model.get(yamlPath(state.lang)) ?? '', key, text))
  renderName(name)
}

// ---------------------------------------------------------------------------
// Texts panel: every block and every site.yml key of the page language
// ---------------------------------------------------------------------------
export function openTexts(): void {
  const prefix = `content/${state.lang}/`
  const fbPrefix = `content/${state.fallbackLang}/`
  const names = new Set<string>()
  for (const p of model.keys()) {
    if (p.startsWith(prefix) && p.endsWith('.md')) names.add(p.slice(prefix.length))
    if (p.startsWith(fbPrefix) && p.endsWith('.md')) names.add(p.slice(fbPrefix.length))
  }
  const own = stringsOf(state.lang)
  const fb = state.fallbackLang === state.lang ? {} : stringsOf(state.fallbackLang)
  const keys = [...new Set([...Object.keys(fb), ...Object.keys(own)])]

  const d = dialog()
  d.innerHTML = `
    <h2>Texts (${state.lang})</h2>
    <h3>Blocks</h3>
    <div class="cms-list cms-blocks"></div>
    <h3>Strings</h3>
    <p>Strings used in attributes (alt, title, meta description) change on the page only after the next build.</p>
    <div class="cms-strings"></div>
    <div class="cms-row"><button type="button" class="cms-btn cms-primary cms-close">Close</button></div>`
  const blocks = d.querySelector('.cms-blocks') as HTMLElement
  for (const n of [...names].sort()) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cms-btn'
    b.textContent = n
    b.addEventListener('click', () => openEditor(n))
    blocks.append(b)
  }
  const box = d.querySelector('.cms-strings') as HTMLElement
  for (const k of keys) {
    const label = document.createElement('label')
    label.textContent = k
    const input = document.createElement('input')
    input.value = own[k] ?? ''
    if (fb[k] !== undefined) input.placeholder = fb[k]
    input.addEventListener('change', () => {
      setFile(yamlPath(state.lang), setString(model.get(yamlPath(state.lang)) ?? '', k, input.value))
      renderName(k)
    })
    label.append(input)
    box.append(label)
  }
  d.querySelector('.cms-close')!.addEventListener('click', () => d.close())
  d.showModal()
}

// ---------------------------------------------------------------------------
// Bind
// ---------------------------------------------------------------------------
// Language links keep ?edit.
function keepEditInLinks(): void {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[hreflang]')) {
    const url = new URL(a.href, location.href)
    if (!new URLSearchParams(url.search.toLowerCase()).has('edit')) {
      url.search = url.search ? url.search + '&edit' : '?edit'
      a.href = url.toString()
    }
  }
}

export function bindPage(): void {
  scan()
  // The served page shows the last build; show the local drafts instead.
  for (const r of ranges) render(r)
  buildPencils()
  placePencils()
  keepEditInLinks()
  window.addEventListener('resize', placePencils)
  window.setInterval(placePencils, 1000)
  // Double-click inside any range opens its editor; links inside ranges do not navigate while editing.
  // The caret node gives the exact text under the pointer; a string directly inside its element (<a>##key##</a>) is matched by that parent.
  const rangeAt = (x: number, y: number, target: EventTarget | null) => {
    const node = document.caretRangeFromPoint?.(x, y)?.startContainer ?? (target as Node | null)
    const el = target instanceof Element ? target : null
    return ranges.find((r) => (node && domRange(r).isPointInRange(node, 0)) || (!isBlockKey(r.key) && el && r.start.parentNode === el))
  }
  document.addEventListener('dblclick', (e) => {
    const r = rangeAt(e.clientX, e.clientY, e.target)
    if (r) {
      e.preventDefault()
      openEditor(r.key)
    }
  })
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target instanceof Element ? e.target.closest('a') : null
      if (a && !a.hasAttribute('hreflang') && rangeAt(e.clientX, e.clientY, a)) e.preventDefault()
    },
    true,
  )
}
