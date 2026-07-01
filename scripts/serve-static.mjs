// Zero-dependency static file server — serves a directory over plain HTTP with
// no framework. Used by `npm run preview` to serve publish/ exactly as any
// static host (nginx, GitHub Pages, python -m http.server) would, proving the
// published site + cms.js need nothing special at runtime.
//
// Usage: node scripts/serve-static.mjs [dir=example-site/publish] [port=4173]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'

const root = process.argv[2] || 'example-site/publish'
const port = Number(process.argv[3]) || 4173

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

async function resolveFile(urlPath) {
  // Decode, strip query, normalize, and block path traversal out of root.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]))
    .replace(/^([/\\])+/, '')
    .split(/[/\\]/)
    .filter((s) => s !== '..')
    .join(sep)
  let fsPath = join(root, clean)
  try {
    if ((await stat(fsPath)).isDirectory()) fsPath = join(fsPath, 'index.html')
  } catch {
    /* fall through to read attempt / 404 */
  }
  return fsPath
}

createServer(async (req, res) => {
  const fsPath = await resolveFile(req.url || '/')
  try {
    const body = await readFile(fsPath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(fsPath).toLowerCase()] || 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
  }
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}/`)
})
