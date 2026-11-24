# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cmsfree is a backend-less editor for static sites that use the "unfolding" content format (`docs/FORMAT.md`). The whole engine compiles to a single self-contained `cms.js` "sleeper" that a site loads on every page but that stays **dormant** until the URL carries `?edit`. In edit mode it loads the site's `content/` files into memory, binds the live page to them (edit pencils, editor dialog, Texts panel) and autosaves. The site's own build (e.g. GitHub Actions) renders and deploys; cmsfree is only the editor.

**Requirements:** Node.js. Folder mode needs a Chromium browser (File System Access API); browser mode works elsewhere.

## Commands

- `npm run dev` - renders the example site (`build:example`), then Vite serves `example-site/dist` at http://localhost:5173. Open `/en/?edit`. The dev plugin swaps `<script src="../cms.js">` for `src/cms.ts` (hot reload).
- `npm run build` - bundle `src/cms.ts` into one IIFE: `dist/cms.js`. Sites copy it to `www/public/cms.js`. Run it after changes under `src/` if you want the built file.
- `npm run build:example` - render `example-site/www/index.html` per language into `example-site/dist/<lang>/index.html` (markers on), copy css, copy `dist/cms.js` if present.
- `npm run preview` - serve `example-site/dist` on a plain static server (port 4173).

There is no test framework and no lint/format script. Formatting is `.prettierrc` (no semicolons, single quotes, trailing commas, width 200).

## Architecture

### Format and markers

One template (`www/index.html`) with `##placeholders##`, one folder per language under `content/` (`NAME.md` blocks + `site.yml` strings). The first language (`en`) is the fallback. The renderer wraps editable output in comments: `<!--cms:KEY-->…<!--/cms-->`. Blocks are always wrapped; strings only in text context (not in attributes, not directly inside `title/textarea/script/style`); built-ins never. `cms.js` finds these ranges on the live page. Rules and placeholders: `docs/FORMAT.md`.

`src/format.ts` is **pure** (no DOM, no FSA). It holds marked rendering, `renderPage`, marker helpers, the small `site.yml` parser and `setString` (replaces a key's line in place). Its output must stay identical to the site builds using the same format (unfolding.pt `scripts/build-content.mjs`): `new Marked({ gfm: true })`, `parse().trim()`, same `renderItems`, same `escapeHtml`. `scripts/build-example.mjs` bundles it with esbuild, so the example uses the exact browser code.

### Modes and storage

Chosen once per site (localStorage `cmsfree:mode:<siteKey>`). Without `showDirectoryPicker` it is always browser mode.

- **Browser mode:** OPFS `sites/<owner>__<repo>__<branch>/` holds `content/**` and `.cmsfree/meta.json` (the **base**: `{commit, tree, files: {path: blobSha}}` from the last pull/publish). Boot: no meta -> pull; else if the branch head differs from the base commit -> pull silently when nothing is unpublished, otherwise `confirm()`. Pull replaces the local `content/` entirely. **Publish** (`runPublish` in `cms.ts`): flush, changed = files whose git blob SHA differs from the base; if the head moved, a changed path whose head SHA differs from the base SHA is a conflict; otherwise blobs -> tree (`base_tree`) -> commit -> `PATCH ref` with `force:false`; update meta; poll `actions/runs?head_sha=` every 5 s.
- **Folder mode:** a local clone picked via FSA; the handle is kept in IndexedDB (permission is re-granted by a user gesture). Autosave writes there. No Publish button.

Site identity: owner/repo are detected on `*.github.io`, otherwise set in the settings dialog. Settings (owner, repo, branch, token) live in localStorage `cmsfree:github:<host[/repo]>`.

Setup link: the settings dialog builds `<page>?edit#cmsfree=<base64url JSON of owner, repo, branch, token>` ("Copy setup link"). On boot `importSetupLink()` stores those settings for the site, forces browser mode and strips the fragment from the address bar and history. The fragment never reaches a server, but base64 is not encryption: the link is as secret as the token.

### Editing on the page

`page.ts` pairs `cms:KEY` comments with the next `/cms` comment of the same parent (a range). Block ranges get a pencil in an absolutely positioned overlay; double-click inside any range opens its editor `<dialog>`. Re-render replaces the nodes between the markers using a `<template>` (so `<li>` parses). The page language is `<html lang>`, falling back to the first language folder. Edits go through `store.setFile()` -> autosave after 1 s (only changed files). `beforeunload` warns only while a save is pending.

### Module boundaries

- `state.ts` imports nothing: shared singleton, model `Map<path, text>`, types, constants.
- `disk.ts`: IndexedDB handle store, OPFS root, raw read/write/list/remove relative to `state.root`.
- `format.ts`: pure (above).
- `store.ts`: load model, autosave, base comparison, status line.
- `github.ts`: settings + dialog, `gh()`, pull, publish, build polling. No storage access; callers pass data in and out.
- `page.ts`: marker ranges, pencils, editor, Texts panel, re-render.
- `chrome.ts`: injected `cms-` CSS (sites ship no cms CSS), bar, dialog helper, launcher, edit-mode entry/exit. It gets its button handlers through the injected `barActions` object so it never imports store/github/page.
- `cms.ts`: boot and wiring (mode choice, pull/resync, publish).

## Code style

- Codified in `.prettierrc`. English identifiers and comments.
- The engine is content-agnostic: `src/` must never hardcode anything about a specific site. `example-site/` is sample data, not part of the engine.
