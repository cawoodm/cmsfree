// Pure string helpers: frontmatter, slugs, titles, HTML escaping, glob. No state.

export function splitFrontmatter(text: string): {
  frontmatter: string
  body: string
} {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  if (!m) return { frontmatter: '', body: text }
  return { frontmatter: m[0], body: text.slice(m[0].length) }
}

export function parseFrontmatter(text: string): {
  title?: string
  order?: number
} {
  const { frontmatter } = splitFrontmatter(text)
  const out: { title?: string; order?: number } = {}
  const t = /^title:\s*(.+)$/m.exec(frontmatter)
  if (t) out.title = t[1].trim().replace(/^["']|["']$/g, '')
  const o = /^order:\s*(\d+)$/m.exec(frontmatter)
  if (o) out.order = Number(o[1])
  return out
}

export function setFrontmatterTitle(text: string, title: string): string {
  const { frontmatter, body } = splitFrontmatter(text)
  if (frontmatter) {
    if (/^title:.*$/m.test(frontmatter))
      return frontmatter.replace(/^title:.*$/m, `title: ${title}`) + body
    return frontmatter.replace(/^---\r?\n/, `---\ntitle: ${title}\n`) + body
  }
  return `---\ntitle: ${title}\n---\n\n` + text
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function titleize(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )
}

// Turn a simple glob (only '*' = "any run of non-slash chars") into a RegExp
// anchored to match a whole filename.
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '[^/]*')}$`)
}
