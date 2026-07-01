import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(fileURLToPath(import.meta.url))
// Absolute, forward-slashed path to the CMS entry for Vite's /@fs/ dev URL.
const cmsEntry = resolve(repoRoot, 'src/cms.ts').replace(/\\/g, '/')
// Static asset SOURCE (css, images, favicon, built cms.js). Copied into
// publish/ by Publish; ignored by the content model (underscore prefix).
const assetsDir = resolve(repoRoot, 'example-site/content/_assets')

// IMPORTANT: nothing here is required at RUNTIME. The published site (publish/ +
// cms.js) runs on ANY static web server. Vite is only a dev convenience — it
// serves publish/ statically and hot-swaps cms.ts — and the cms.js bundler.
// The dev server serves NOTHING from content/: view mode = static publish/;
// edit mode = cms.js reads content/ from disk (FSA) and rebuilds in memory.
export default defineConfig({
  root: resolve(repoRoot, 'example-site/publish'),
  publicDir: false,

  server: {
    // Allow importing src/cms.ts, which lives OUTSIDE the dev root.
    fs: { allow: [repoRoot] },
    // Watch ONLY src/. Everything under example-site/ is data/output the CMS
    // reads/writes at runtime — never dev module code — so it must not trigger
    // reloads. src/cms.ts stays in the module graph → HMR still works.
    watch: { ignored: ['**/example-site/**'] },
  },

  plugins: [
    {
      // DEV ONLY: hot-swap the deployed `<script src="cms.js">` for the
      // TypeScript entry so editing cms.ts hot-reloads. On a real static server
      // the page keeps its real cms.js — this plugin does not run there.
      name: 'cms-dev-inject',
      apply: 'serve',
      transformIndexHtml(html) {
        const mod = `<script type="module" src="/@fs/${cmsEntry}"></script>`
        return html.replace(
          /<script\s+src="(?:\.\.\/|\/)?cms\.js"><\/script>/g,
          mod,
        )
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
})
