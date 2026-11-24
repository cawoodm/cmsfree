// The content format helpers: pure functions, no DOM, no FSA. cms.js uses them to re-render edited keys in the browser.
// The output must stay identical to what a site's Hugo build produces (see hugo/layouts/_partials/): marked with gfm, same items split, same escaping.
import { Marked } from 'marked'

const marked = new Marked({ gfm: true })

export function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (c) => map[c])
}

export function renderBlock(markdown: string): string {
  return (marked.parse(markdown) as string).trim()
}

// Splits at "### " headings, one <li> per part. The <div> keeps the heading and all paragraphs together as one flex child.
export function renderItems(markdown: string): string {
  const parts = markdown
    .split(/^(?=### )/m)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length && !parts[0].startsWith('### ')) throw new Error('##…:items## block must start with a "### " heading, found text before it')
  return parts.map((part) => `<li><div>${(marked.parse(part) as string).trim()}</div></li>`).join('\n')
}

// ---------------------------------------------------------------------------
// Keys and markers
// ---------------------------------------------------------------------------
// A key is "NAME.md", "NAME.md:items" or an i18n string key ("menu_home").
export function splitKey(key: string): { name: string; items: boolean } {
  const m = /^(.*?)(:items)?$/.exec(key)!
  return { name: m[1], items: !!m[2] }
}

export function isBlockKey(key: string): boolean {
  return splitKey(key).name.endsWith('.md')
}

// The key of an opening marker comment (its text, without <!-- -->), or null.
export function parseMarker(commentText: string): string | null {
  return commentText.startsWith('cms:') ? commentText.slice(4) : null
}

export function isMarkerClose(commentText: string): boolean {
  return commentText === '/cms'
}

// Renders the HTML for one key from its source text (Markdown, or a plain string).
export function renderKeyHtml(key: string, source: string): string {
  if (!isBlockKey(key)) return escapeHtml(source)
  return splitKey(key).items ? renderItems(source) : renderBlock(source)
}

// ---------------------------------------------------------------------------
// i18n/<lang>.yaml: one "key: text" line each
// ---------------------------------------------------------------------------
export function parseStrings(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Za-z0-9_]+)\s*:(?:\s+(.*))?$/.exec(line)
    if (!m) continue
    out[m[1]] = parseValue((m[2] ?? '').trim())
  }
  return out
}

function parseValue(v: string): string {
  if (v.startsWith('"')) {
    // JSON-style escapes; find the closing quote
    let i = 1
    while (i < v.length && v[i] !== '"') i += v[i] === '\\' ? 2 : 1
    try {
      return JSON.parse(v.slice(0, i + 1))
    } catch {
      return v.slice(1, i)
    }
  }
  if (v.startsWith("'")) {
    let s = ''
    for (let i = 1; i < v.length; i++) {
      if (v[i] === "'") {
        if (v[i + 1] === "'") {
          s += "'"
          i++
        } else break
      } else s += v[i]
    }
    return s
  }
  const c = v.search(/\s#/)
  return (c >= 0 ? v.slice(0, c) : v).trim()
}

function formatValue(value: string): string {
  const needsQuotes =
    value === '' ||
    /^\s|\s$/.test(value) ||
    /: |\s#|:$/.test(value) ||
    /[\r\n]/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(value) ||
    /^[-+]?(\d[\d_]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value)
  return needsQuotes ? JSON.stringify(value) : value
}

// Replaces the line of `key` in place (keeps order and comments), or appends it.
export function setString(yamlText: string, key: string, value: string): string {
  const eol = yamlText.includes('\r\n') ? '\r\n' : '\n'
  const lines = yamlText.split(/\r?\n/)
  const line = `${key}: ${formatValue(value)}`
  const at = lines.findIndex((l) => l.startsWith(key + ':') || l.startsWith(key + ' :'))
  if (at >= 0) lines[at] = line
  else if (lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line)
  else lines.push(line)
  return lines.join(eol)
}

// Files the editor loads, edits, pulls and publishes (paths relative to the site root):
//   content/<lang>/blocks/NAME.md   blocks of a multilingual site
//   content/blocks/NAME.md          blocks of a single-language site
//   i18n/<lang>.yaml                strings
//   hugo.toml                       read-only: only read for defaultContentLanguage
export const SITE_CONFIG = 'hugo.toml'
export const isSitePath = (p: string) => /^content\/(?:[^/]+\/)?blocks\/[^/]+\.md$/.test(p) || /^i18n\/[^/]+\.ya?ml$/.test(p) || p === SITE_CONFIG

// defaultContentLanguage of hugo.toml (Hugo's own default is "en").
export function parseDefaultLang(toml: string | undefined): string {
  const m = /^\s*defaultContentLanguage\s*=\s*["']([^"']+)["']/m.exec(toml ?? '')
  return m ? m[1] : 'en'
}

// Git blob SHA-1: sha1("blob " + byteLength + "\0" + utf8 bytes), as hex.
export async function blobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
