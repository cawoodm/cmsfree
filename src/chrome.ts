// UI chrome: injected edit CSS, the top bar (status + buttons), dialog helper,
// the view-mode re-entry launcher, and edit-mode detection/entry/exit. Imports
// only state. The bar's buttons call injected handlers (`barActions`) that the
// entry registers, so this module never imports the store/github/page modules.
import { EDITOR_FLAG } from './state'

// package.json version, injected by Vite (`define` in vite.config.ts).
declare const __CMSFREE_VERSION__: string

const BAR_HEIGHT = 40
const REPO_URL = 'https://github.com/cawoodm/cmsfree'

// Sites ship no cms CSS: everything the editor needs is injected here, namespaced with "cms-".
const CSS = `
.cms-bar{position:fixed;top:0;left:0;right:0;height:${BAR_HEIGHT}px;z-index:2147483000;display:flex;align-items:center;gap:10px;padding:0 12px;box-sizing:border-box;background:#22262b;color:#e8eaed;font:13px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.cms-bar *{box-sizing:border-box}
.cms-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cms-actions{display:flex;gap:6px}
.cms-spacer{flex:1}
.cms-btn{font:inherit;padding:6px 12px;border:1px solid #5a6270;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.cms-btn:hover:not(:disabled){background:#33383f}
.cms-btn:disabled{opacity:.45;cursor:default}
.cms-btn.cms-primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
.cms-btn.cms-primary:hover:not(:disabled){background:#2f6fd6}
.cms-icon{padding:6px 9px}
.cms-launch{position:fixed;top:0;left:0;z-index:2147483000;width:26px;height:26px;padding:0;border:none;border-bottom-right-radius:8px;cursor:pointer;background:#22262b;color:#e8eaed;font:14px/26px system-ui,sans-serif;opacity:.35;transition:opacity .15s}
.cms-launch:hover{opacity:1}
.cms-overlay{position:absolute;top:0;left:0;width:0;height:0;z-index:2147482000}
.cms-pencil{position:absolute;width:26px;height:26px;padding:0;border:none;border-radius:50%;background:#3b82f6;color:#fff;font:14px/26px system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4);opacity:.85}
.cms-pencil:hover{opacity:1}
.cms-dialog{margin:auto;width:min(720px,92vw);max-height:86vh;padding:18px;border:none;border-radius:10px;background:#fff;color:#1b1f24;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:auto}
.cms-dialog::backdrop{background:rgba(0,0,0,.45)}
.cms-dialog h2{margin:0 0 10px;font:600 16px/1.3 system-ui,sans-serif}
.cms-dialog h3{margin:16px 0 6px;font:600 13px/1.3 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#59626d}
.cms-dialog p{margin:0 0 10px;color:#59626d}
.cms-dialog label{display:block;margin:0 0 10px;font-weight:600}
.cms-dialog label span{display:block;font-weight:400;color:#59626d;font-size:12px}
.cms-dialog textarea,.cms-dialog input{display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #c3c9d0;border-radius:6px;font:14px/1.4 system-ui,sans-serif;color:#1b1f24;background:#fff}
.cms-dialog textarea{min-height:46vh;font:13px/1.5 ui-monospace,Consolas,monospace;resize:vertical}
.cms-dialog .cms-row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.cms-dialog .cms-btn{border-color:#c3c9d0;color:#1b1f24}
.cms-dialog .cms-btn:hover:not(:disabled){background:#eef0f3}
.cms-dialog .cms-btn.cms-primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
.cms-dialog .cms-list{display:flex;flex-wrap:wrap;gap:6px}
.cms-dialog [hidden]{display:none}
.cms-dialog .cms-copy-link{margin-right:auto}
.cms-dialog.cms-about{width:min(420px,92vw);text-align:center}
.cms-dialog.cms-about h2{font-size:22px;margin-bottom:2px}
.cms-dialog.cms-about .cms-version{font-size:12px}
.cms-dialog.cms-about a{color:#3b82f6}
.cms-dialog.cms-about .cms-row{justify-content:center}
`

export function injectStyles(): void {
  if (document.getElementById('cms-style')) return
  const style = document.createElement('style')
  style.id = 'cms-style'
  style.textContent = CSS
  document.head.append(style)
}

// ---------------------------------------------------------------------------
// Edit-mode detection + entry/exit
// ---------------------------------------------------------------------------
export function isEditMode(): boolean {
  return new URLSearchParams(location.search.toLowerCase()).has('edit')
}

// Leaves edit mode: same page without `?edit`. The beforeunload handler still warns while a save is pending.
export function exitEditMode(): void {
  const url = new URL(location.href)
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'edit') url.searchParams.delete(key)
  location.href = url.toString()
}

// Re-enter edit mode on the CURRENT page: add `?edit` (keeping path + hash).
export function enterEditMode(): void {
  location.href = location.pathname + location.search + (location.search ? '&' : '?') + 'edit' + location.hash
}

// A small fixed pencil at the top-left corner (view mode, returning editors).
export function showEditLauncher(): void {
  if (document.getElementById('cms-launch')) return
  injectStyles()
  const btn = document.createElement('button')
  btn.id = 'cms-launch'
  btn.className = 'cms-launch'
  btn.type = 'button'
  btn.title = 'Edit this site'
  btn.setAttribute('aria-label', 'Edit this site')
  btn.textContent = '✎'
  btn.addEventListener('click', enterEditMode)
  document.body.appendChild(btn)
}

export function rememberEditor(): void {
  try {
    localStorage.setItem(EDITOR_FLAG, '1')
  } catch {
    /* storage blocked */
  }
}

export function isReturningEditor(): boolean {
  try {
    return localStorage.getItem(EDITOR_FLAG) === '1'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Top edit bar:  [ status ] [ transient actions ] ........ [ Texts ] [ Publish ] [ ⚙ ] [ ? ] [ × ]
// ---------------------------------------------------------------------------
export const barActions = {
  onPublish: () => {},
  onTexts: () => {},
  onSettings: () => {},
}

export interface BarAction {
  label: string
  onClick: () => void
}

function button(label: string, cls: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cms-btn ' + cls
  b.textContent = label
  if (title) {
    b.title = title
    b.setAttribute('aria-label', title)
  }
  b.addEventListener('click', onClick)
  return b
}

export function ensureBar(): HTMLElement {
  let bar = document.getElementById('cms-bar')
  if (bar) return bar
  injectStyles()
  bar = document.createElement('div')
  bar.id = 'cms-bar'
  bar.className = 'cms-bar'
  const msg = document.createElement('span')
  msg.className = 'cms-msg'
  const actions = document.createElement('span')
  actions.className = 'cms-actions'
  const spacer = document.createElement('span')
  spacer.className = 'cms-spacer'
  const texts = button('Texts', 'cms-texts', () => barActions.onTexts())
  const publish = button('Publish', 'cms-publish cms-primary', () => barActions.onPublish())
  const gear = button('⚙', 'cms-gear cms-icon', () => barActions.onSettings(), 'GitHub settings')
  const help = button('?', 'cms-help cms-icon', showAbout, 'About cmsfree')
  const done = button('×', 'cms-done cms-icon', exitEditMode, 'Exit edit mode')
  for (const b of [texts, publish, gear]) b.style.display = 'none'
  bar.append(msg, actions, spacer, texts, publish, gear, help, done)
  document.body.prepend(bar)
  document.body.style.paddingTop = `${BAR_HEIGHT}px` // push the page down below the fixed bar
  return bar
}

// Set the status message plus optional inline action buttons.
export function setStatus(message: string, ...actions: BarAction[]): void {
  const bar = ensureBar()
  ;(bar.querySelector('.cms-msg') as HTMLElement).textContent = message
  const box = bar.querySelector('.cms-actions') as HTMLElement
  box.textContent = ''
  for (const a of actions) box.append(button(a.label, '', a.onClick))
}

export function setButtons(b: { texts?: boolean; publish?: boolean; publishEnabled?: boolean; gear?: boolean }): void {
  const bar = ensureBar()
  const set = (sel: string, show: boolean | undefined) => {
    if (show !== undefined) (bar.querySelector(sel) as HTMLElement).style.display = show ? '' : 'none'
  }
  set('.cms-texts', b.texts)
  set('.cms-publish', b.publish)
  set('.cms-gear', b.gear)
  if (b.publishEnabled !== undefined) (bar.querySelector('.cms-publish') as HTMLButtonElement).disabled = !b.publishEnabled
}

// A fresh modal <dialog> that removes itself when closed.
// Esc and a click outside close it; Ctrl/Cmd+Enter clicks its primary button (OK, Save, Close).
export function dialog(className = ''): HTMLDialogElement {
  injectStyles()
  const d = document.createElement('dialog')
  d.className = ('cms-dialog ' + className).trim()
  // Blur first so a pending input "change" (Texts panel) still fires before the dialog goes away.
  const dismiss = () => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    d.close()
  }
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      ;(document.activeElement as HTMLElement | null)?.blur()
      d.querySelector<HTMLButtonElement>('.cms-primary')?.click()
    }
  })
  // Outside = on the backdrop. Both press and release must be outside, so a text selection dragged out of the box does not close it.
  const outside = (e: MouseEvent) => {
    const r = d.getBoundingClientRect()
    return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
  }
  let downOutside = false
  d.addEventListener('mousedown', (e) => (downOutside = outside(e)))
  d.addEventListener('click', (e) => {
    if (downOutside && outside(e)) dismiss()
    downOutside = false
  })
  d.addEventListener('close', () => d.remove())
  document.body.append(d)
  return d
}

// An error dialog: a title and one paragraph per line, with Reload and Close.
export function showError(title: string, lines: string[]): void {
  const d = dialog()
  const h = document.createElement('h2')
  h.textContent = title
  d.append(h)
  for (const line of lines) {
    const p = document.createElement('p')
    p.textContent = line
    d.append(p)
  }
  const row = document.createElement('div')
  row.className = 'cms-row'
  row.append(
    button('Reload', '', () => location.reload()),
    button('Close', 'cms-primary', () => d.close()),
  )
  d.append(row)
  d.showModal()
}

// The "?" dialog: name, version, a link to the repo and a short pitch.
export function showAbout(): void {
  const d = dialog('cms-about')
  const title = document.createElement('h2')
  title.textContent = 'CMSFree'
  const version = document.createElement('p')
  version.className = 'cms-version'
  version.textContent = `Version ${__CMSFREE_VERSION__}`
  const pitch = document.createElement('p')
  pitch.textContent = 'A tiny CMS with no backend: edit your static site right on the page and publish straight to GitHub. No server, no database, no lock-in, just your files.'
  const link = document.createElement('a')
  link.href = REPO_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'github.com/cawoodm/cmsfree'
  const linkLine = document.createElement('p')
  linkLine.append(link)
  const row = document.createElement('div')
  row.className = 'cms-row'
  row.append(button('Close', 'cms-primary', () => d.close()))
  d.append(title, version, pitch, linkLine, row)
  d.showModal()
}
