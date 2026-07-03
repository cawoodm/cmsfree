// Publish — generate the static publish/ site from the model. Auto-saves first
// (so content/ is current), pre-renders one HTML file per route from the shell
// template, and syncs publish/version.json to content/version.json.
import { state, model, VERSION_PATH } from './state'
import type { Section } from './state'
import {
  resolveDir,
  readFile,
  writeFile,
  verifyPermission,
  removeAllExcept,
  copyInto,
  inBatches,
} from './disk'
import { scanSections, modelRoutes, slugOfPath } from './model'
import {
  splitFrontmatter,
  parseFrontmatter,
  titleize,
  escapeHtml,
  evalShowExpr,
} from './markdown'
import { routeHref, routeToOutPath, defaultSlug } from './routes'
import { renderBody } from './content'
import { setStatus } from './chrome'
import { saveAll } from './save'

function buildNavHtml(sections: Section[], route: string, base: string): string {
  const items = sections
    .map(
      (s) =>
        `<li><a href="${routeHref(s.slug, base)}"${route === s.slug ? ' class="active"' : ''}>${escapeHtml(s.title)}</a></li>`,
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
    page: { slug: string }
  },
): string {
  const doc = new DOMParser().parseFromString(template, 'text/html')
  // Strip template comments from the published output, but keep the cms:entry
  // marker (replaced with the sleeper script after serialization).
  const walker = doc.createNodeIterator(doc, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    comments.push(n as Comment)
  comments.forEach((c) => {
    if (c.data.trim() !== 'cms:entry') c.remove()
  })
  const titleEl = doc.querySelector('title')
  if (titleEl) titleEl.textContent = opts.title
  const navHost = doc.querySelector('[x-cms-nav]')
  if (navHost) navHost.innerHTML = opts.navHtml
  const contentHost = doc.querySelector('[x-cms-content]')
  if (contentHost) contentHost.innerHTML = opts.contentHtml
  // Conditionally-shown elements (e.g. the hero): resolved at publish time, so
  // static output needs no client-side JS and no trace of the expression —
  // drop elements whose expression is false, and strip the attribute off the
  // ones that stay.
  doc.querySelectorAll<HTMLElement>('[data-cms-show]').forEach((el) => {
    if (evalShowExpr(el.getAttribute('data-cms-show')!, opts.page))
      el.removeAttribute('data-cms-show')
    else el.remove()
  })
  // All output paths are RELATIVE to this page, so the site is portable to any
  // subpath (GitHub project pages), the domain root, or file://. Every page is
  // either home (depth 0) or a section/block (depth 1), hence base '' or '../'.
  const base = opts.isHome ? '' : '../'
  // Turn hash routes (#/about-us) into relative static links everywhere.
  doc.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]').forEach((a) => {
    a.setAttribute(
      'href',
      routeHref(a.getAttribute('href')!.slice(2).replace(/\/$/, ''), base),
    )
  })
  // Rebase root-absolute asset paths (/css, /images) to be relative to the page.
  doc.querySelectorAll('[src],[href]').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href'
    const v = el.getAttribute(attr) || ''
    if (!v.startsWith('/') || v.startsWith('//')) return // external / already relative
    el.setAttribute(attr, base + v.slice(1))
  })
  let html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
  // The dormant sleeper: comment placeholder → production script (relative).
  return html.replace(
    /<!--\s*cms:entry\s*-->/g,
    `<script src="${base}cms.js"></script>`,
  )
}

// Render every route's static HTML page from the template + model. Pure aside
// from needing DOMParser/NodeFilter in scope — native in browsers; the CLI
// build script (scripts/publish-content.mjs) polyfills both via linkedom
// before this module is loaded. Shared by publishSite() below and the CLI
// script, so the two never drift apart.
export function renderPages(
  template: string,
  sections: Section[],
  routes: { route: string; path: string }[],
  model: Map<string, string>,
): { outPath: string; html: string }[] {
  return routes.map(({ route, path }) => {
    const text = model.get(path)!
    const { body } = splitFrontmatter(text)
    const fm = parseFrontmatter(text)
    const title = fm.title || titleize(defaultSlug(route))
    const page = { slug: fm.slug || defaultSlug(route) }
    const base = route === '' ? '' : '../'
    const html = buildPage(template, {
      title,
      navHtml: buildNavHtml(sections, route.includes('/') ? '' : route, base),
      contentHtml: renderBody(body, slugOfPath(path), path),
      isHome: route === '',
      page,
    })
    return { outPath: routeToOutPath(route), html }
  })
}

export async function publishSite(): Promise<void> {
  if (!state.dirHandle) return void setStatus('Connect a folder first.')
  if (state.dirty) {
    setStatus('Saving before publish…')
    await saveAll()
    if (state.dirty) return // save failed — saveAll already reported why
  }
  if (!(await verifyPermission(state.dirHandle, true))) {
    return void setStatus('Publish needs folder access.', 'Reconnect', () =>
      location.reload(),
    )
  }
  const btn = document.querySelector(
    '#cms-banner .cms-publish',
  ) as HTMLButtonElement | null
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Publishing… 0%'
  }
  try {
    const template = await readFile('content/template.html')
    const sections = scanSections()
    const routes = modelRoutes()

    // Progress is measured across one unit per page plus a final unit for the
    // asset copy; the button shows the running percentage as each unit lands.
    const totalSteps = routes.length + 1
    let step = 0
    const showProgress = (): void => {
      if (btn)
        btn.textContent = `Publishing… ${Math.round((step / totalSteps) * 100)}%`
    }

    // Clean rebuild: the whole site is regenerated from content/, so wipe
    // publish/ first (keeping only version.json). No stale files can survive.
    const publishDir = await resolveDir(['publish'], true)
    await removeAllExcept(publishDir, new Set(['version.json']))

    // 1. Generate one static HTML page per route, then write them to disk 8 at
    // a time (independent files → safe to run concurrently) for speed.
    const pages = renderPages(template, sections, routes, model)
    await inBatches(pages, 8, async ({ outPath, html }) => {
      await writeFile(outPath, html)
      step++
      showProgress()
    })

    // 2. Copy static assets (css/, images/, favicon, cms.js) from their source.
    let assetNote = ''
    try {
      await copyInto(await resolveDir(['content', '_assets']), publishDir)
    } catch {
      assetNote =
        ' (no content/_assets — run `npm run build` to produce cms.js and add css/images there)'
    }
    step++
    showProgress()

    // 3. Sync publish version to the (just-saved) content version.
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
      `Rebuilt publish/ from content/: ${routes.length} page(s), version ${v}.${assetNote}`,
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
