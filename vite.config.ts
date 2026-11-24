import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
// Absolute, forward-slashed path to the CMS entry for Vite's /@fs/ dev URL.
const cmsEntry = resolve(repoRoot, 'src/cms.ts').replace(/\\/g, '/')
// The example site (sources + built dist/) is dev data, not engine source: chokidar
// must see it so Vite's static-file cache stays valid, but it must never trigger HMR/reload.
const exampleSiteDir = resolve(repoRoot, 'example-site')

// IMPORTANT: nothing here is required at RUNTIME. Sites copy the built dist/cms.js
// into their own repo (www/public/cms.js). Vite is only a dev convenience (serves the
// rendered example, hot-swaps cms.ts) and the cms.js bundler.
export default defineConfig({
  // `npm run build:example` renders the example site here: dist/<lang>/index.html
  root: resolve(repoRoot, 'example-site/dist'),
  publicDir: false,

  server: {
    // Allow importing src/cms.ts, which lives OUTSIDE the dev root.
    fs: { allow: [repoRoot] },
  },

  plugins: [
    {
      // DEV ONLY: hot-swap the template's `<script src="../cms.js">` for the TypeScript
      // entry so editing src/ hot-reloads. A real site keeps its real cms.js.
      name: 'cms-dev-inject',
      apply: 'serve',
      transformIndexHtml(html) {
        const mod = `<script type="module" src="/@fs/${cmsEntry}"></script>`
        return html.replace(/<script\s+src="(?:\.\.\/|\/)?cms\.js"><\/script>/g, mod)
      },
      // Writes under example-site/ (rebuilds, autosave in folder mode) must not trigger HMR/full reload.
      // Returning [] swallows the update; src/cms.ts is not under example-site/, so it keeps normal HMR.
      handleHotUpdate(ctx) {
        if (ctx.file.startsWith(exampleSiteDir)) return []
      },
    },
  ],

  build: {
    // A single self-contained IIFE: dist/cms.js
    outDir: resolve(repoRoot, 'dist'),
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(repoRoot, 'src/cms.ts'),
      name: 'cmsfree',
      fileName: () => 'cms.js',
      formats: ['iife'],
    },
  },
})
