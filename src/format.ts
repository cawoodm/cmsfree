// The content format: pure functions, no DOM, no FSA. Used by cms.js in the
// browser and by scripts/build-example.mjs in Node. The rendering must stay
// identical to the site builds that use the same format (e.g. unfolding.pt).
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
// A key is "NAME.md", "NAME.md:items" or a site.yml key ("menu_home").
export function splitKey(key: string): { name: string; items: boolean } {
  const m = /^(.*?)(:items)?$/.exec(key)!
  return { name: m[1], items: !!m[2] }
}

export function isBlockKey(key: string): boolean {
  return splitKey(key).name.endsWith('.md')
}

export function wrapMarker(key: string, html: string): string {
  return `<!--cms:${key}-->${html}<!--/cms-->`
}

// The key of an opening marker comment (its text, without <!-- -->), or null.
export function markerKey(commentText: string): string | null {
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

// True when the placeholder at `offset` sits in element text: not inside a tag
// (attribute value) and not directly inside a raw-text element, where a comment would show as text.
export function isTextContext(template: string, offset: number): boolean {
  const before = template.slice(0, offset)
  if (before.lastIndexOf('<') > before.lastIndexOf('>')) return false
  let last: RegExpExecArray | null = null
  const re = /<(\/?)(title|textarea|script|style)\b[^>]*>/gi
  for (let m = re.exec(before); m; m = re.exec(before)) last = m
  return !(last && !last[1])
}

// ---------------------------------------------------------------------------
// site.yml: one "key: text" line each
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

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------
export interface Content {
  blocks: Record<string, string>
  strings: Record<string, string>
}

export interface PageOptions extends Content {
  lang: string
  languages: string[]
  // Used for content missing in `lang` (never for the fallback language itself).
  fallback?: Content & { lang: string }
  // Wrap editable output in <!--cms:KEY-->…<!--/cms--> comments.
  markers?: boolean
  // Called once with the placeholders that used the fallback, e.g. ["##title##"].
  onFallback?: (used: string[]) => void
}

export function renderPage(template: string, opts: PageOptions): string {
  const { lang, languages, blocks, strings, markers = false } = opts
  const fb = opts.fallback && opts.fallback.lang !== lang ? opts.fallback : null
  const builtins: Record<string, () => string> = {
    LANG: () => lang,
    LANG_SWITCH: () =>
      languages
        .map((l) => (l === lang ? `<span aria-current="true">${l.toUpperCase()}</span>` : `<a href="../${l}/" hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`))
        .join('<span aria-hidden="true">|</span>'),
  }
  const fallbacks: string[] = []

  const html = template.replace(/##([A-Za-z0-9_.-]+?)(?::(items))?##/g, (_all, key: string, mode: string | undefined, offset: number) => {
    const fullKey = mode ? `${key}:${mode}` : key
    if (key.endsWith('.md')) {
      let source = blocks
      if (!(key in blocks)) {
        if (fb && key in fb.blocks) {
          source = fb.blocks
          fallbacks.push(`##${fullKey}##`)
        } else {
          throw new Error(`${lang}: no content for placeholder ##${key}## (expected file content/${lang}/${key}${fb ? ` and content/${fb.lang}/${key}` : ''}; the name is case-sensitive)`)
        }
      }
      const out = mode === 'items' ? renderItems(source[key]) : renderBlock(source[key])
      return markers ? wrapMarker(fullKey, out) : out
    }
    if (mode) throw new Error(`${lang}: ##${key}:${mode}## is only allowed on a .md placeholder`)
    if (/^[a-z0-9_]+$/.test(key)) {
      let source = strings
      if (!(key in strings)) {
        if (fb && key in fb.strings) {
          source = fb.strings
          fallbacks.push(`##${key}##`)
        } else {
          throw new Error(`${lang}: no content for placeholder ##${key}## (expected key "${key}" in content/${lang}/site.yml${fb ? ` and content/${fb.lang}/site.yml` : ''})`)
        }
      }
      const out = escapeHtml(source[key])
      return markers && isTextContext(template, offset) ? wrapMarker(key, out) : out
    }
    if (/^[A-Z0-9_]+$/.test(key) && builtins[key]) return builtins[key]()
    throw new Error(`${lang}: unknown placeholder ##${key}## (use ##NAME.md## for a file, ##lowercase_key## for site.yml, or a built-in: ${Object.keys(builtins).join(', ')})`)
  })
  opts.onFallback?.(fallbacks)
  return html
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
