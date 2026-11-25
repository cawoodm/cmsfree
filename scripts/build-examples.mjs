// Builds both sample sites (samples/) with Hugo into <site>/dist and copies dist/cms.js (the built editor) next to the pages if it exists.
// Needs Hugo (extended not required) on the PATH. No --minify: it would strip the edit markers.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cmsJs = path.join(repoRoot, 'dist', 'cms.js')

for (const site of ['samples/example-site', 'samples/example-site-multilingual']) {
  const out = path.join(repoRoot, site, 'dist')
  try {
    execFileSync('hugo', ['-s', path.join(repoRoot, site), '-d', out, '--cleanDestinationDir'], { stdio: 'inherit' })
  } catch {
    console.error(`build-examples: hugo failed for ${site} (is Hugo installed and on the PATH?)`)
    process.exit(1)
  }
  if (existsSync(cmsJs)) copyFileSync(cmsJs, path.join(out, 'cms.js'))
}
