// Renders the example site: example-site/www/index.html + content/<lang>/ ->
// example-site/dist/<lang>/index.html (edit markers on), the same way a real site's
// build does. Bundles src/format.ts with esbuild in memory, so this always renders
// with the exact code cms.js uses in the browser.
//
// Usage: node scripts/build-example.mjs
import { build } from 'esbuild'
import { readFile, writeFile, mkdir, rm, readdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const siteDir = path.join(repoRoot, 'example-site')
const contentDir = path.join(siteDir, 'content')
const wwwDir = path.join(siteDir, 'www')
const distDir = path.join(siteDir, 'dist')

// Bundle the pure format module into memory and import it as a data: module.
async function loadFormat() {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'src/format.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18',
  })
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`)
}

async function loadLanguage(format, lang) {
  const dir = path.join(contentDir, lang)
  const blocks = {}
  let strings = {}
  for (const file of (await readdir(dir)).sort()) {
    const text = await readFile(path.join(dir, file), 'utf8')
    if (file.endsWith('.md')) blocks[file] = text
    else if (file === 'site.yml') strings = format.parseStrings(text)
  }
  return { lang, blocks, strings }
}

const format = await loadFormat()
const template = await readFile(path.join(wwwDir, 'index.html'), 'utf8')
const languages = (await readdir(contentDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)))
const content = Object.fromEntries(await Promise.all(languages.map(async (l) => [l, await loadLanguage(format, l)])))
const fallback = content[languages[0]]

await rm(distDir, { recursive: true, force: true })
for (const lang of languages) {
  const html = format.renderPage(template, {
    ...content[lang],
    languages,
    fallback,
    markers: true,
    onFallback: (used) => used.length && console.warn(`${lang}: using ${fallback.lang} content for ${used.join(', ')}`),
  })
  await mkdir(path.join(distDir, lang), { recursive: true })
  await writeFile(path.join(distDir, lang, 'index.html'), html)
}
await cp(path.join(wwwDir, 'css'), path.join(distDir, 'css'), { recursive: true })
await writeFile(path.join(distDir, 'index.html'), `<!DOCTYPE html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=${languages[0]}/">\n<a href="${languages[0]}/">${languages[0]}</a>\n`)
const cmsJs = path.join(repoRoot, 'dist', 'cms.js')
if (existsSync(cmsJs)) await cp(cmsJs, path.join(distDir, 'cms.js'))
console.log(`Rendered ${languages.join(', ')} -> ${path.relative(repoRoot, distDir)}`)
