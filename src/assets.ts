// Edit-mode assets — read from disk (FSA) as in-memory blob URLs, so nothing is
// fetched over HTTP from content/ or publish/. Reflects live content/_assets.
import type { Entries } from './state'
import { resolveDir } from './disk'

const ASSET_MIME: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  json: 'application/json',
}
const assetUrls = new Map<string, string>() // 'css/style.css' -> blob: URL

function mimeFor(name: string): string {
  return (
    ASSET_MIME[name.split('.').pop()?.toLowerCase() || ''] ||
    'application/octet-stream'
  )
}

// Read content/_assets recursively into blob URLs keyed by root-relative path.
export async function loadAssetUrls(): Promise<void> {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url)
  assetUrls.clear()
  let dir: FileSystemDirectoryHandle
  try {
    dir = await resolveDir(['content', '_assets'])
  } catch {
    return // no _assets — leave the map empty
  }
  async function walk(
    d: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const [name, h] of (d as any).entries() as Entries) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (h.kind === 'file') {
        const buf = await (
          await (h as FileSystemFileHandle).getFile()
        ).arrayBuffer()
        assetUrls.set(
          rel,
          URL.createObjectURL(new Blob([buf], { type: mimeFor(name) })),
        )
      } else {
        await walk(h as FileSystemDirectoryHandle, rel)
      }
    }
  }
  await walk(dir, '')
}

// Rewrite [src]/[href] pointing at a bundled asset to its in-memory blob URL.
// Leaves external (http, //, data:, blob:, mailto:, #, /@fs, /@vite) refs alone.
export function rewriteAssetRefs(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[src],[href]').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href'
    const v = el.getAttribute(attr) || ''
    if (
      !v ||
      /^(https?:|blob:|data:|mailto:|tel:|#)/i.test(v) ||
      v.startsWith('//')
    )
      return
    const url = assetUrls.get(v.replace(/^\/+/, ''))
    if (url) el.setAttribute(attr, url)
  })
}
