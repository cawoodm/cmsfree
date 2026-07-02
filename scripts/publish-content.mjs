// Generate a site's publish/ tree from its content/ tree on the command line
// — the same rendering pipeline as the in-browser Publish button (src/publish.ts),
// run over the real filesystem instead of the File System Access API. Bundles
// the engine's pure model/publish modules with esbuild so this always renders
// with the exact same code the browser uses; nothing here is reimplemented.
//
// Usage: node scripts/publish-content.mjs [siteRoot=example-site]
import { build } from 'esbuild'
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  stat,
  cp,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser, NodeFilter } from 'linkedom'

// src/publish.ts's buildPage() expects a browser-global DOMParser/NodeFilter.
globalThis.DOMParser = DOMParser
globalThis.NodeFilter = NodeFilter

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const siteRoot = path.resolve(repoRoot, process.argv[2] || 'example-site')
const contentDir = path.join(siteRoot, 'content')
const publishDir = path.join(siteRoot, 'publish')

// Bundle the pure rendering pipeline into memory and import it as a data:
// module — no build artifact left on disk.
async function loadEngine() {
  const result = await build({
    entryPoints: [path.join(scriptsDir, 'publish-entry.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18',
  })
  const code = result.outputFiles[0].text
  return import(`data:text/javascript,${encodeURIComponent(code)}`)
}

// Load content/ into the model — mirrors src/model.ts's loadModel(), reading
// via fs instead of the File System Access API.
async function loadContent(model, isManagedSectionDir) {
  for (const name of await readdir(contentDir)) {
    const full = path.join(contentDir, name)
    const st = await stat(full)
    if (st.isFile() && name.endsWith('.md')) {
      model.set(`content/${name}`, await readFile(full, 'utf8'))
    } else if (st.isDirectory() && isManagedSectionDir(name)) {
      for (const fn of await readdir(full)) {
        if (fn.endsWith('.md'))
          model.set(
            `content/${name}/${fn}`,
            await readFile(path.join(full, fn), 'utf8'),
          )
      }
    }
  }
}

async function main() {
  if (!existsSync(contentDir)) {
    console.error(`No content/ directory found at ${contentDir}`)
    process.exitCode = 1
    return
  }

  const { model, scanSections, modelRoutes, isManagedSectionDir, renderPages } =
    await loadEngine()
  await loadContent(model, isManagedSectionDir)

  const templatePath = path.join(contentDir, 'template.html')
  if (!existsSync(templatePath)) {
    console.error(`No content/template.html found at ${templatePath}`)
    process.exitCode = 1
    return
  }
  const template = await readFile(templatePath, 'utf8')
  const sections = scanSections()
  const routes = modelRoutes()

  // Clean rebuild: wipe publish/ first (keeping only version.json), same as
  // publishSite() — no stale files can survive.
  await mkdir(publishDir, { recursive: true })
  for (const name of await readdir(publishDir))
    if (name !== 'version.json')
      await rm(path.join(publishDir, name), { recursive: true, force: true })

  // 1. Generate one static HTML page per route from the single template.
  const pages = renderPages(template, sections, routes, model)
  for (const { outPath, html } of pages) {
    const dest = path.join(siteRoot, outPath)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, html)
  }

  // 2. Copy static assets (css/, images/, favicon, cms.js) from their source.
  const assetsDir = path.join(contentDir, '_assets')
  let assetNote = ''
  if (existsSync(assetsDir)) {
    await cp(assetsDir, publishDir, { recursive: true })
  } else {
    assetNote =
      ' (no content/_assets — run `npm run build` to produce cms.js and add css/images there)'
  }

  // 3. Sync publish version to the content version.
  let version = 0
  try {
    version =
      JSON.parse(await readFile(path.join(contentDir, 'version.json'), 'utf8'))
        .version ?? 0
  } catch {
    /* missing/malformed → 0 */
  }
  await writeFile(
    path.join(publishDir, 'version.json'),
    JSON.stringify({ version, updated: new Date().toISOString() }, null, 2) +
      '\n',
  )

  console.log(
    `Rebuilt ${path.relative(repoRoot, publishDir)} from content/: ${pages.length} page(s), version ${version}.${assetNote}`,
  )
}

main().catch((err) => {
  console.error('Publish failed:', err.message)
  process.exitCode = 1
})
