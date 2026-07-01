import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const repoRoot = dirname(fileURLToPath(import.meta.url))
// Absolute, forward-slashed path to the CMS entry for Vite's /@fs/ dev URL.
const cmsEntry = resolve(repoRoot, 'src/cms.ts').replace(/\\/g, '/')
// The single layout template — served at / in dev and used by Publish.
const templatePath = resolve(repoRoot, 'example-site/content/template.html')

export default defineConfig({
  // Root is the published output, so /css, /images, /cms.js and the generated
  // /section/ pages resolve as static files. The `/` route itself is overridden
  // to serve the single layout template (see the cms-serve-template plugin).
  root: resolve(repoRoot, 'example-site/publish'),
  publicDir: false,

  server: {
    // Allow importing src/cms.ts, which lives OUTSIDE the dev root.
    fs: { allow: [repoRoot] },
    // Watch ONLY src/ for changes. Everything under example-site/ is data/output
    // the CMS reads and writes at runtime (content/, publish/, template, assets) —
    // never dev module code — so it must not trigger reloads. This also prevents
    // Save/Publish (which write into publish/) from reloading the page mid-run.
    // src/cms.ts is outside example-site/ and stays in the module graph → HMR works.
    watch: { ignored: ['**/example-site/**'] },
  },

  plugins: [
    {
      // DEV ONLY: serve the SINGLE layout template (content/template.html) at /,
      // so editing runs on exactly the same shell that Publish generates from.
      // Assets (/css, /images) and generated pages (/about-us/…) still come from
      // the publish/ root. Runs before Vite's own html serving.
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
      // DEV ONLY: inject the CMS as a hot-reloading ES module sourced from the
      // TypeScript entry. The template carries a `<!-- cms:entry -->` placeholder;
      // Publish instead replaces it with the built `<script src="cms.js">`. This
      // handles both (and the generated pages served for /section/ URLs).
      name: 'cms-dev-inject',
      apply: 'serve',
      transformIndexHtml(html) {
        // In dev, inject the CMS as a hot-reloading TS module — replacing either
        // the `<!-- cms:entry -->` placeholder (template) OR the production
        // `<script src="/cms.js">` that Publish writes (generated pages), so HMR
        // works whether a page is pre- or post-Publish.
        const mod = `<script type="module" src="/@fs/${cmsEntry}"></script>`
        return html
          .replace('<!-- cms:entry -->', mod)
          .replace(/<script\s+src="\/?cms\.js"><\/script>/g, mod)
      },
    },
  ],

  build: {
    // Build the CMS as a single self-contained IIFE file, emitted directly into
    // the example site's publish/ so the generated pages' `<script src="/cms.js">`
    // resolves. A real site would drop this same file into its own publish/.
    outDir: resolve(repoRoot, 'example-site/publish'),
    emptyOutDir: false, // publish/ holds the site too — don't wipe it
    lib: {
      entry: resolve(repoRoot, 'src/cms.ts'),
      name: 'cmsfree',
      fileName: () => 'cms.js',
      formats: ['iife'],
    },
  },
})
