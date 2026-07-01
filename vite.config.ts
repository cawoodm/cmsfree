import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const repoRoot = dirname(fileURLToPath(import.meta.url))
// Absolute, forward-slashed path to the CMS entry for Vite's /@fs/ dev URL.
const cmsEntry = resolve(repoRoot, 'src/cms.ts').replace(/\\/g, '/')
// The single layout template — served at / in dev and used by Publish.
const templatePath = resolve(repoRoot, 'example-site/content/template.html')
// Static asset SOURCE (css, images, favicon, built cms.js). Ignored by the
// content model (underscore prefix); copied into publish/ by Publish.
const assetsDir = resolve(repoRoot, 'example-site/content/_assets')

export default defineConfig(({ command }) => ({
  // Root is the published output, so generated /section/ pages resolve as static
  // files. `/` is overridden to serve the single layout template, and static
  // assets are served from their source in content/_assets (see below).
  root: resolve(repoRoot, 'example-site/publish'),
  // In dev, serve /css, /images, /favicon.ico, /cms.js from the asset SOURCE.
  // At build time this would collide with outDir, so it's disabled there.
  publicDir: command === 'serve' ? assetsDir : false,

  server: {
    // Allow importing src/cms.ts, which lives OUTSIDE the dev root.
    fs: { allow: [repoRoot] },
    // Watch ONLY src/ for changes. Everything under example-site/ is data/output
    // the CMS reads and writes at runtime — never dev module code — so it must
    // not trigger reloads. src/cms.ts stays in the module graph → HMR works.
    watch: { ignored: ['**/example-site/**'] },
  },

  plugins: [
    {
      // DEV ONLY: serve the SINGLE layout template (content/template.html) at /,
      // so editing runs on exactly the same shell that Publish generates from.
      name: 'cms-serve-template',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url || '/').split('?')[0]
          if (path !== '/' && path !== '/index.html') return next()
          try {
            const raw = readFileSync(templatePath, 'utf8')
            const html = await server.transformIndexHtml(req.url || '/', raw)
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          } catch (err) {
            next(err as Error)
          }
        })
      },
    },
    {
      // DEV ONLY: inject the CMS as a hot-reloading TS module — replacing either
      // the `<!-- cms:entry -->` placeholder (template) or the production
      // `<script src="cms.js">` (generated pages, relative or root-absolute).
      name: 'cms-dev-inject',
      apply: 'serve',
      transformIndexHtml(html) {
        const mod = `<script type="module" src="/@fs/${cmsEntry}"></script>`
        return html
          .replace('<!-- cms:entry -->', mod)
          .replace(/<script\s+src="(?:\.\.\/|\/)?cms\.js"><\/script>/g, mod)
      },
    },
  ],

  build: {
    // Build the CMS as a single self-contained IIFE into the asset SOURCE dir,
    // so it's the bundle Publish copies into publish/cms.js. `npm run build`
    // refreshes content/_assets/cms.js after any cms.ts change.
    outDir: assetsDir,
    emptyOutDir: false, // _assets also holds css/images/favicon — don't wipe them
    copyPublicDir: false,
    lib: {
      entry: resolve(repoRoot, 'src/cms.ts'),
      name: 'cmsfree',
      fileName: () => 'cms.js',
      formats: ['iife'],
    },
  },
}))
