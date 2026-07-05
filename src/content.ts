// Render a page body to HTML, expanding [include](glob) directives — the way a
// page pulls in Blocks (_name.md) and Posts (name.part.md). Shared by edit-mode
// preview (view.ts) and Publish (publish.ts) so both stay in sync.
import { marked } from 'marked'
import { model } from './state'
import { splitFrontmatter, parseFrontmatter, titleize, globToRegExp } from './markdown'

// Sibling .md files in content/{sectionSlug}/ whose filename matches the glob,
// excluding the including file itself, sorted like scanSections() (order,
// then title).
export function matchSectionFiles(
  sectionSlug: string,
  pattern: string,
  excludePath: string,
): { text: string }[] {
  const prefix = `content/${sectionSlug}/`
  const re = globToRegExp(pattern)
  const out: { text: string; order: number; title: string }[] = []
  for (const [path, text] of model) {
    if (!path.startsWith(prefix) || path === excludePath) continue
    const name = path.slice(prefix.length)
    if (name.includes('/') || !re.test(name)) continue
    const fm = parseFrontmatter(text)
    out.push({
      text,
      order: fm.order ?? Number.MAX_SAFE_INTEGER,
      title: fm.title || titleize(name.replace(/\.md$/, '')),
    })
  }
  out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  return out
}

// Render a page body to HTML, expanding [include](glob) directives (a line
// containing exactly that) — this is how a page includes its Blocks and Posts.
// If sectionSlug is '' (e.g. the home page has no section folder), directives
// are left as literal text — they degrade to a harmless markdown link rather
// than silently vanishing, since that's not the "zero matches" case the
// directive is meant to handle.
export function renderBody(
  body: string,
  sectionSlug: string,
  selfPath: string,
): string {
  const placeholders: string[] = []
  const withPlaceholders = body.replace(
    /^\[include\]\(([^)\s]+)\)[ \t]*$/gm,
    (match, pattern: string) => {
      if (!sectionSlug) return match
      const token = `token-${placeholders.length}`
      const html = matchSectionFiles(sectionSlug, pattern, selfPath)
        .map((f) => {
          const { body: fBody } = splitFrontmatter(f.text)
          return `<article class="cms-include">${marked.parse(fBody) as string}</article>`
        })
        .join('')
      placeholders.push(html)
      return `<div data-cms-include="${token}"></div>`
    },
  )
  let html = marked.parse(withPlaceholders) as string
  placeholders.forEach((inc, i) => {
    html = html.replace(`<div data-cms-include="token-${i}"></div>`, inc)
  })
  return html
}

// Render a root-level Block (e.g. content/_footer.md) — for template-wide
// content, like a shared footer, that isn't scoped to any page or section.
function renderTemplateBlock(fileName: string): string {
  const text = model.get(`content/${fileName}`)
  if (!text) return ''
  const { body } = splitFrontmatter(text)
  return renderBody(body, '', `content/${fileName}`)
}

// Fill every template `x-cms-block="<file>"` placeholder within `root` with
// that Block's rendered content. Used both by Publish (on the parsed
// template doc) and edit mode (on the live document, once the shell is
// applied) — see view.ts's applyTemplateShell().
export function applyTemplateBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[x-cms-block]').forEach((el) => {
    const name = el.getAttribute('x-cms-block')
    if (name) el.innerHTML = renderTemplateBlock(name)
  })
}
