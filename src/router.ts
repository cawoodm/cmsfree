// Runtime router (EDIT MODE ONLY) — in-memory hash routing over the model.
import { state, model } from './state'
import { currentRoute, routeToPath, routeFromAnchor, defaultSlug } from './routes'
import { parseFrontmatter, evalShowExpr } from './markdown'
import { contentEl, renderCurrent } from './view'
import { setStatus } from './chrome'

// A route reached via its real published URL (e.g. 'hidden', from /hidden/)
// carries no trace of the '_' hidden-section convention (see routes.ts
// publicSlug). Fall back to the '_'-prefixed section slug so those pages
// still resolve when entering edit mode directly on them.
function resolvePath(route: string): string {
  const path = routeToPath(route)
  if (model.has(path)) return path
  const segs = route.split('/')
  const hiddenPath = routeToPath(['_' + segs[0], ...segs.slice(1)].join('/'))
  return model.has(hiddenPath) ? hiddenPath : path
}

function updateActiveNav(route: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[x-cms-nav] a').forEach((a) => {
    const r = routeFromAnchor(a)
    a.classList.toggle('active', r !== null && r === route)
  })
}

// Toggle `data-cms-show` elements (e.g. the hero) for the current page —
// mirrors what buildPage() does for the published static pages.
function applyPageShow(page: { slug: string }): void {
  document.querySelectorAll<HTMLElement>('[data-cms-show]').forEach((el) => {
    const show = evalShowExpr(el.getAttribute('data-cms-show')!, page)
    el.style.display = show ? '' : 'none'
  })
}

export function renderRoute(): void {
  if (!state.loaded) return
  const route = currentRoute()
  const path = resolvePath(route)
  const text = model.get(path)
  applyPageShow({ slug: (text && parseFrontmatter(text).slug) || defaultSlug(route) })
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
