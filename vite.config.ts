import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
// Absolute, forward-slashed path to the CMS entry for Vite's /@fs/ dev URL.
const cmsEntry = resolve(repoRoot, 'src/cms.ts').replace(/\\/g, '/')
// The example sites (sources + built dist/) are dev data, not engine source: chokidar
// must see them so Vite's static-file cache stays valid, but they must never trigger HMR/reload.
const exampleDirs = [resolve(repoRoot, 'example-site'), resolve(repoRoot, 'example-site-multilingual')]

// IMPORTANT: nothing here is required at RUNTIME. Sites copy the built dist/cms.js
// into their own repo (static/cms.js). Vite is only a dev convenience (serves the
// rendered example, hot-swaps cms.ts) and the cms.js bundler.
export default defineConfig(({ mode }) => ({
  // `npm run build:examples` renders the example sites; `--mode multilingual` serves the one with a folder per page (/en/, /de/).
  root: resolve(repoRoot, mode === 'multilingual' ? 'example-site-multilingual/dist' : 'example-site/dist'),
  publicDir: false,
  // Shown in the editor's "?" dialog (src/chrome.ts).
  define: { __CMSFREE_VERSION__: JSON.stringify(version) },

  server: {
    // Allow importing src/cms.ts, which lives OUTSIDE the dev root.
    fs: { allow: [repoRoot] },
  },

  plugins: [
    {
      // DEV ONLY: hot-swap the template's `<script src="cms.js">` (any path, e.g. `/cms.js` from `relURL`) for the TypeScript
      // entry so editing src/ hot-reloads. A real site keeps its real cms.js.
      name: 'cms-dev-inject',
      apply: 'serve',
      transformIndexHtml(html) {
        const mod = `<script type="module" src="/@fs/${cmsEntry}"></script>`
        return html.replace(/<script\s+src="[^"]*cms\.js"><\/script>/g, mod)
      },
      // Writes under example-site*/ (rebuilds, autosave in folder mode) must not trigger HMR/full reload.
      // Returning [] swallows the update; src/cms.ts is not under example-site*/, so it keeps normal HMR.
      handleHotUpdate(ctx) {
        if (exampleDirs.some((dir) => ctx.file.startsWith(dir))) return []
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
}))
