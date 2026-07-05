# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cmsfree is a backend-less CMS for static sites. The whole engine compiles to a single self-contained `cms.js` "sleeper" that ships on every published page but stays **dormant** — it does nothing until the URL carries `?edit`. In edit mode it connects to a local folder via the browser's **File System Access API (FSA)**, turns the live static page into an in-browser editor, and writes plain markdown back to disk. There is no server, no database, and nothing depends on any framework at runtime — the published site is portable static HTML.

**Requirements:** Node.js and a Chromium browser (Chrome/Edge — FSA is Chromium-only).

## Commands

- `npm run dev` — Vite dev server at http://localhost:5173. **Edit mode lives at `/?edit`.** The dev server serves `example-site/publish/` statically and hot-swaps the `<script src="cms.js">` tag for `src/cms.ts` so editing the engine hot-reloads.
- `npm run build` — bundle `src/cms.ts` into a single IIFE at `example-site/content/_assets/cms.js`. **You must run this after any change under `src/`** — the published site ships the built bundle, not the TypeScript. HMR only reflects `src/` edits inside the running dev server.
- `npm run preview` — serve `example-site/publish/` on a plain static server (port 4173), proving the output runs with no dev tooling.
- `npm run publish:content [siteRoot]` — regenerate a site's `publish/` from its `content/` on the command line (Node), using the _same_ rendering pipeline as the in-browser Publish button.
- `npm run publish` — maintainer-only: `publish.ps1` builds, `robocopy /MIR`s the example site into a sibling `../cawoodm.github.io/cmsfree-example` checkout, and git-pushes it. Uses PowerShell + the real git CLI.

There is **no test framework** and **no lint/format npm script**. See "Code style" below regarding the config files.

## Architecture

### The three tiers and the one write path

Data flows `content/` → in-memory model → `publish/`, all under a single connected **site root** folder:

- **`content/`** — the editable markdown source (plus `template.html`, `_assets/`, `manifest.json`, `version.json`). The one source of truth you edit.
- **`model`** (`src/state.ts`) — a `Map<contentPath, rawText>`. On connect the entire `content/` tree is read into it. **All edits — text and structural create/rename/delete — mutate this map only.** Nothing touches disk until Save.
- **`publish/`** — generated static HTML, one pre-rendered page per route, plus copied assets. Regenerated wholesale on Publish; never hand-edited.

`src/save.ts` (`saveAll`) is the **only** code path that writes `content/` to disk: it flushes every model file, regenerates `manifest.json`, prunes disk entries no longer in the model, and bumps `content/version.json` exactly once. Publish auto-saves first, then rebuilds `publish/` and mirrors the version.

### Boot sequence (`src/cms.ts`)

`boot()` runs on every page but returns immediately unless `?edit` is set (view mode just shows a re-entry pencil for returning editors). In edit mode it: `ensureConnected()` (restore the FSA handle from IndexedDB or prompt to connect) → `ensureSynced()` (pull from GitHub if the folder is empty, or offer re-sync if the local copy is older — see sync below) → `loadModel()` → render nav + route. Edits stay in memory; `beforeunload` warns on unsaved changes.

### FSA + persistence (`src/disk.ts`)

All disk I/O goes through here: the IndexedDB handle store (survives reloads; permission must be re-granted via a user gesture), `readFile`/`writeFile`/`writeBytes`/`resolveDir`, and `inBatches(items, size, task)` for bounded-concurrency writes (Save and Publish write files 8 at a time). The connected handle is a **site root** containing both `content/` and `publish/` — not a git clone.

### Shared rendering pipeline — keep in sync

`renderPages()` in `src/publish.ts` is the pure template→HTML pipeline. It is used by **both** the in-browser `publishSite()` and the CLI `scripts/publish-content.mjs` (which bundles the engine's pure modules with esbuild and polyfills `DOMParser`/`NodeFilter` via `linkedom`). This is deliberate so the browser and CLI never drift — when changing rendering, both paths get it automatically, but be aware anything you add to `buildPage`/`renderPages` must stay browser-and-Node safe (no FSA, no DOM beyond what linkedom provides).

### GitHub deploy & sync (`src/github.ts`, `src/sync.ts`)

Deploy uses the **GitHub Git Data REST API** (blobs → tree → commit → ref) — no git binary, no clone. It pushes `publish/` (to the branch root or an optional `subdir`) **and** the `content/` source (to `contentSubdir`, default `_content`) in one commit, so another machine can reconstruct the whole project. `sync.ts` is the reverse: pull `content/` + `publish/` into an empty folder, or re-sync when the local `content/version.json` is behind the repo's. The `gh()` helper is token-optional (public repos pull anonymously). Settings (token, owner, repo, branch, subdirs, commit prefix) live in `localStorage` under `cmsfree:github`; there is no config file.

### Content model conventions

A `.md` file's role is decided by its **filename** — the single source of truth is `classifyFile()` in `src/model.ts` (full write-up in `docs/CONCEPTS.md`):

- **Section** — a folder with an `index.md`; published, in the nav (`scanSections()`).
- **Page** — `name.md` (no leading `_`, no dot in the name); published to its own URL, not in nav.
- **Block** — `_name.md`; never published alone, only `[include]`d into a page.
- **Post** — `name.part.md` (e.g. `index.blog-1.md`); never published alone, surfaced only in a list.
- **Hidden** — `.name.md`; never published (reserved).

`modelRoutes()` publishes only Sections and Pages. **Watch the underscore ambiguity:** on a *folder* a leading `_` is a hidden Section (still published, just not in nav, URL drops the `_`); on a *file* it's a Block (not published). Frontmatter keys: `title`, `slug`, `order`. `content/template.html` is the single layout source for every published page; `[data-cms-show]` expressions are resolved at publish time and stripped from the output.

### Module boundaries

`src/state.ts` imports nothing — it holds the shared singleton, types, and constants. `src/chrome.ts` (the edit bar UI) receives its button handlers via an injected `barActions` object rather than importing `save`/`publish`/`github`, to avoid upward import cycles; `cms.ts` is the entry that wires those handlers together.

## Code style

- codified in `.prettierrc`.

The engine is content-agnostic: `src/` must never hardcode anything about a specific site's `content/` or `publish/`. `example-site/` is sample data/output, not part of the engine.
