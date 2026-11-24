// Renders a site: <siteDir>/www/index.html + <siteDir>/content/ -> <siteDir>/dist/ (edit markers on),
// the same way a real site's build does. Bundles src/format.ts with esbuild in memory, so this always
// renders with the exact code cms.js uses in the browser.
//
// content/ without subfolders: one page, dist/index.html, rendered from the root content.
// content/ with subfolders: one page per folder, dist/<dir>/index.html; the root files are shared defaults.
// dist/index.html then redirects to the folder that matches the browser language, else to the default folder.
//
// Usage: node scripts/build-site.mjs <siteDir> [--default <dir>]
import { build } from 'esbuild'
import { readFile, writeFile, mkdir, rm, readdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const defaultAt = args.indexOf('--default')
const defaultOpt = defaultAt >= 0 ? args.splice(defaultAt, 2)[1] : undefined
const siteArg = args[0]
if (!siteArg || (defaultAt >= 0 && !defaultOpt)) {
  console.error('Usage: node scripts/build-site.mjs <siteDir> [--default <dir>]')
  process.exit(1)
}
const siteDir = path.resolve(siteArg)
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

// The .md files and site.yml directly inside `dir`.
async function loadContent(format, dir) {
  const blocks = {}
  let strings = {}
  for (const file of (await readdir(dir)).sort()) {
    if (file.endsWith('.md')) blocks[file] = await readFile(path.join(dir, file), 'utf8')
    else if (file === 'site.yml') strings = format.parseStrings(await readFile(path.join(dir, file), 'utf8'))
  }
  return { blocks, strings }
}

// "/" page of a site with folders: JS picks the folder that matches navigator.languages (first 2 letters or the full name),
// without JS a meta refresh goes to the default folder. The links work either way.
function redirectPage(dirs, defaultDir) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${defaultDir}</title>
<script>
  (function () {
    var dirs = ${JSON.stringify(dirs)}, target = ${JSON.stringify(defaultDir)}
    var langs = navigator.languages || [navigator.language || '']
    for (var i = 0; i < langs.length; i++) {
      var full = String(langs[i]).toLowerCase(), short = full.slice(0, 2)
      var hit = dirs.filter(function (d) { return d.toLowerCase() === full || d.toLowerCase() === short })[0]
      if (hit) { target = hit; break }
    }
    location.replace(target + '/' + location.search + location.hash)
  })()
</script>
<noscript><meta http-equiv="refresh" content="0; url=${defaultDir}/"></noscript>
</head>
<body>
${dirs.map((d) => `<a href="${d}/">${d}</a>`).join('\n')}
</body>
</html>
`
}

try {
  if (!existsSync(path.join(wwwDir, 'index.html'))) throw new Error(`missing template ${path.join(wwwDir, 'index.html')}`)
  if (!existsSync(contentDir)) throw new Error(`missing ${contentDir}`)
  const format = await loadFormat()
  const template = await readFile(path.join(wwwDir, 'index.html'), 'utf8')
  const root = await loadContent(format, contentDir)
  const dirs = (await readdir(contentDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const defaultDir = defaultOpt ?? dirs[0]
  if (dirs.length && !dirs.includes(defaultDir)) throw new Error(`--default ${defaultDir}: no such folder in content/ (${dirs.join(', ')})`)

  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })
  // Everything in www/ except the template (css/, images, ...) goes to the site root.
  for (const e of await readdir(wwwDir)) if (e !== 'index.html') await cp(path.join(wwwDir, e), path.join(distDir, e), { recursive: true })

  if (!dirs.length) {
    const html = format.renderPage(template, { ...root, dir: '', dirs, fallback: null, markers: true })
    await writeFile(path.join(distDir, 'index.html'), html)
  } else {
    // The template is written relative to the site root; a folder page is one level deeper.
    const folderTemplate = format.prefixRelativeUrls(template)
    for (const dir of dirs) {
      const html = format.renderPage(folderTemplate, {
        ...(await loadContent(format, path.join(contentDir, dir))),
        dir,
        dirs,
        fallback: root,
        markers: true,
      })
      await mkdir(path.join(distDir, dir), { recursive: true })
      await writeFile(path.join(distDir, dir, 'index.html'), html)
    }
    await writeFile(path.join(distDir, 'index.html'), redirectPage(dirs, defaultDir))
  }
  const cmsJs = path.join(repoRoot, 'dist', 'cms.js')
  if (existsSync(cmsJs)) await cp(cmsJs, path.join(distDir, 'cms.js'))
  console.log(`Rendered ${dirs.length ? dirs.join(', ') : 'index.html'} -> ${path.relative(repoRoot, distDir)}`)
} catch (err) {
  console.error(`build-site: ${err.message}`)
  process.exit(1)
}
