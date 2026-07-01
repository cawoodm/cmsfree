// Runtime router (EDIT MODE ONLY) — in-memory hash routing over the model.
import { state, model } from './state'
import { currentRoute, routeToPath, routeFromAnchor } from './routes'
import { contentEl, renderCurrent } from './view'
import { setStatus } from './chrome'

function updateActiveNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[x-cms-nav] a').forEach((a) => {
    const r = routeFromAnchor(a)
    a.classList.toggle('active', r !== null && r === route)
  })
}

// Show `data-cms-home-only` elements (e.g. the hero) only on the homepage —
// mirrors what buildPage() does for the published static pages.
function applyHomeOnly(isHome: boolean): void {
  document
    .querySelectorAll<HTMLElement>('[data-cms-home-only]')
    .forEach((el) => {
      el.style.display = isHome ? '' : 'none'
    })
}

export function renderRoute(): void {
  if (!state.loaded) return
  const route = currentRoute()
  applyHomeOnly(route === '')
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
  state.currentText = text
  state.currentPath = path
  renderCurrent()
  updateActiveNav(route)
}

export function onNavClick(e: MouseEvent): void {
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
