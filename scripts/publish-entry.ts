// Bundling entry point for scripts/publish-content.mjs. Re-exports exactly
// the pure, DOM/model pieces the CLI needs from the engine's own source, so
// the CLI renders pages with the SAME code as the in-browser Publish button
// (src/publish.ts) — no separate reimplementation to drift out of sync.
export { model } from '../src/state'
export { scanSections, modelRoutes, isManagedSectionDir } from '../src/model'
export { renderPages } from '../src/publish'
