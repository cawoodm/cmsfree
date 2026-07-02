// Route ↔ path/url mapping. Pure (only reads `location`).

// EDIT MODE route → content/ file path.
//   ''                      → content/index.md
//   'about-us'              → content/about-us/index.md
//   'services/custom-cakes' → content/services/custom-cakes.md
export function routeToPath(route: string): string {
  if (route === '') return 'content/index.md'
  const segs = route.split('/')
  if (segs.length === 1) return `content/${segs[0]}/index.md`
  return `content/${segs.join('/')}.md`
}

// A '_'-prefixed section slug (e.g. '_hidden') is published and reachable but
// left out of the nav (see scanSections). Its public URL drops the underscore
// — content/_hidden/ is served at /hidden/ — so hidden-ness is purely an
// authoring convention, invisible to visitors.
function publicSlug(seg: string): string {
  return seg.startsWith('_') ? seg.slice(1) : seg
}

// Published URL for a route (real static links, not hash routes). Root-absolute;
// used for edit-mode/dev navigation (exitEditMode), which runs at the site root.
export function routeToUrl(route: string): string {
  if (route === '') return '/'
  const segs = route.split('/')
  return segs.length === 1
    ? `/${publicSlug(segs[0])}/`
    : `/${publicSlug(segs[0])}/${segs[1]}.html`
}

// A route's page path RELATIVE to the publish/ root (no leading slash).
export function routeToRelTarget(route: string): string {
  if (route === '') return ''
  const segs = route.split('/')
  return segs.length === 1
    ? `${publicSlug(segs[0])}/`
    : `${publicSlug(segs[0])}/${segs[1]}.html`
}

// A route's href from a page whose depth prefix is `base` ('' for home, '../'
// for section/block pages). Keeps the published site path-agnostic.
export function routeHref(route: string, base: string): string {
  const t = routeToRelTarget(route)
  return t === '' ? base || './' : base + t
}

// Output file for a route within the site root.
export function routeToOutPath(route: string): string {
  if (route === '') return 'publish/index.html'
  const segs = route.split('/')
  return segs.length === 1
    ? `publish/${publicSlug(segs[0])}/index.html`
    : `publish/${publicSlug(segs[0])}/${segs[1]}.html`
}

export function routeFromAnchor(a: HTMLAnchorElement): string | null {
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

export function currentRoute(): string {
  const hash = location.hash.replace(/^#\/?/, '').replace(/\/$/, '')
  if (hash) return hash
  // No hash (e.g. entered ?edit directly on a published sub-page like
  // /about-us/): derive the route from the pathname so edit mode lands there.
  return location.pathname
    .replace(/index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/^\/+|\/+$/g, '')
}
