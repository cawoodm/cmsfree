// UI chrome: the top edit bar, status line, save-button state, the view-mode
// re-entry launcher, and edit-mode detection/entry/exit. Depends only on state
// and pure route helpers. The bar's action buttons call injected handlers
// (`barActions`) that the entry registers, so this module never imports the
// save/publish/deploy operations (avoids upward cycles).
import { state } from './state'
import { routeToUrl, currentRoute } from './routes'

// ---------------------------------------------------------------------------
// Edit-mode detection + entry/exit
// ---------------------------------------------------------------------------
export function isEditMode(): boolean {
  return new URLSearchParams(location.search.toLowerCase()).has('edit')
}

// Leaves edit mode for the published URL of the page being edited (e.g. hash
// route #/contact → /contact/). The existing beforeunload handler still warns
// if there are unsaved changes.
export function exitEditMode(): void {
  location.href = routeToUrl(currentRoute())
}

// Re-enter edit mode on the CURRENT page: add `?edit` (keeping path + hash).
export function enterEditMode(): void {
  const sep = location.search ? '&' : '?'
  location.href =
    location.pathname + location.search + sep + 'edit' + location.hash
}

// A small fixed pencil at the top-left corner (view mode, returning editors).
// Self-contained styling so it works on any published page regardless of CSS.
export function showEditLauncher(): void {
  if (document.getElementById('cms-launch')) return
  const btn = document.createElement('button')
  btn.id = 'cms-launch'
  btn.type = 'button'
  btn.title = 'Edit this site'
  btn.setAttribute('aria-label', 'Edit this site')
  btn.textContent = '✎'
  btn.style.cssText =
    'position:fixed;top:0;left:0;z-index:2147483647;width:26px;height:26px;' +
    'padding:0;border:none;border-bottom-right-radius:8px;cursor:pointer;' +
    'background:#4A2E20;color:#FBF1E4;font:14px/26px system-ui,sans-serif;' +
    'opacity:0.35;transition:opacity .15s'
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'))
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '0.35'))
  btn.addEventListener('click', enterEditMode)
  document.body.appendChild(btn)
}

// ---------------------------------------------------------------------------
// Top edit bar — persistent chrome with status + Save. Never fail silently.
//   [ status message ] [ transient action ] .......... [ Save ]
// Action buttons dispatch to handlers registered by the entry (see cms.ts).
// ---------------------------------------------------------------------------
export const barActions: {
  onSave: () => void
  onPublish: () => void
  onDeploy: () => void
  onSettings: () => void
} = {
  onSave: () => {},
  onPublish: () => {},
  onDeploy: () => {},
  onSettings: () => {},
}

export function ensureBar(): HTMLElement {
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
    save.addEventListener('click', () => barActions.onSave())
    const publish = document.createElement('button')
    publish.className = 'cms-publish'
    publish.type = 'button'
    publish.textContent = 'Publish'
    publish.style.display = 'none'
    publish.addEventListener('click', () => barActions.onPublish())
    const deploy = document.createElement('button')
    deploy.className = 'cms-deploy'
    deploy.type = 'button'
    deploy.textContent = 'Deploy'
    deploy.title = 'Push publish/ to GitHub Pages'
    deploy.style.display = 'none'
    deploy.addEventListener('click', () => barActions.onDeploy())
    const gear = document.createElement('button')
    gear.className = 'cms-gear'
    gear.type = 'button'
    gear.title = 'GitHub deploy settings'
    gear.setAttribute('aria-label', 'GitHub deploy settings')
    gear.textContent = '⚙'
    gear.style.display = 'none'
    gear.addEventListener('click', () => barActions.onSettings())
    const done = document.createElement('button')
    done.className = 'cms-done'
    done.type = 'button'
    done.title = 'Exit edit mode'
    done.setAttribute('aria-label', 'Exit edit mode')
    done.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>'
    done.addEventListener('click', () => exitEditMode())
    bar.append(msg, actions, spacer, save, publish, deploy, gear, done)
    document.body.prepend(bar)
  }
  return bar
}

// Set the status message (+ optional inline action button). Leaves Save intact.
export function setStatus(
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

export function updateSaveButton(): void {
  const bar = ensureBar() // create the bar if it doesn't exist yet
  const save = bar.querySelector('.cms-save') as HTMLButtonElement
  save.style.display = state.connected ? 'inline-block' : 'none'
  save.disabled = !state.dirty
  save.textContent = state.dirty ? 'Save' : 'Saved'
  const publish = bar.querySelector('.cms-publish') as HTMLButtonElement
  publish.style.display = state.connected ? 'inline-block' : 'none'
  const deploy = bar.querySelector('.cms-deploy') as HTMLButtonElement
  deploy.style.display = state.connected ? 'inline-block' : 'none'
  const gear = bar.querySelector('.cms-gear') as HTMLButtonElement
  gear.style.display = state.connected ? 'inline-block' : 'none'
}
