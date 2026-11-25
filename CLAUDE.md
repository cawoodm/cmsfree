# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cmsfree is a backend-less editor for static sites that are plain Hugo sites (format: `docs/FORMAT.md`). The whole engine compiles to a single self-contained `cms.js` "sleeper" that a site loads on every page but that stays **dormant** until the URL carries `?edit`. In edit mode it loads the site's `content/blocks/*.md` and `i18n/*.yaml` into memory, binds the live page to them (edit pencils, editor dialog, Texts panel) and autosaves. The site's own build (Hugo, e.g. in GitHub Actions) renders and deploys; cmsfree is only the editor.

**Requirements:** Node.js and Hugo 0.147+ on the PATH (for the examples). Folder mode needs a Chromium browser (File System Access API); browser mode works elsewhere.

## Commands

- `npm run dev` - builds both example sites (`build:examples`), then Vite serves `samples/example-site/dist` (one language) at http://localhost:5173. Open `/?edit`. `npm run dev:multilingual` serves `samples/example-site-multilingual/dist` instead (open `/en/?edit`). The dev plugin swaps any `<script src="…cms.js">` for `src/cms.ts` (hot reload).
- `npm run build` - bundle `src/cms.ts` into one IIFE: `dist/cms.js`. Sites copy it to `static/cms.js`. Run it after changes under `src/` if you want the built file.
- `npm run build:examples` - `scripts/build-examples.mjs`: `hugo -s <site> -d <site>/dist --cleanDestinationDir` for both example sites, then copies `dist/cms.js` into each output if present. Never `--minify` (it strips the markers).
- `npm run preview` - serve `samples/example-site/dist` on a plain static server (port 4173).

There is no test framework and no lint/format script. Formatting is `.prettierrc` (no semicolons, single quotes, trailing commas, width 200).

## Architecture

### Format and markers

A Hugo site: `layouts/home.html` uses three partials shipped in `hugo/layouts/_partials/` (`cms-block.html`, `cms-items.html`, `cms-text.html`; sites keep a copy). The site keeps Hugo's default layout (no `contentDir`/`i18nDir`): blocks are `content/blocks/NAME.md` in the default (or only) language and `content/blocks/NAME.<lang>.md` in another (Hugo translation by file name), strings are `i18n/<lang>.yaml`. Blocks have no fallback: a block missing in a page's language fails the build (`errorf` in the partials). A string missing in a page's language comes from the default content language (`defaultContentLanguage` in `hugo.toml`), because Hugo's `T` does that; there is no other fallback. The partials wrap editable output in comments: `<!--cms:KEY-->…<!--/cms-->` (KEY is `NAME.md`, `NAME.md:items` or a string key). Blocks are always wrapped; strings only where `cms-text` is used (text context; `{{ T "key" }}` in attributes/`<title>` has no marker). `cms.js` finds these ranges on the live page. Rules: `docs/FORMAT.md`.

`src/format.ts` is **pure** (no DOM, no FSA): marked rendering, `renderItems`, marker helpers, the small i18n yaml parser, `setString` (replaces a key's line in place), `isSitePath` (the editable file set) and `parseDefaultLang`. Its output must stay identical to the partials' Hugo output: `new Marked({ gfm: true })`, `parse().trim()`, same `### ` split, same `escapeHtml`.

### Modes and storage

Chosen once per site (localStorage `cmsfree:mode:<siteKey>`). Without `showDirectoryPicker` it is always browser mode.

- **Browser mode:** OPFS `sites/<owner>__<repo>__<branch>/` holds the site files (`content/blocks/*.md`, `i18n/*.yaml`, `hugo.toml`) and `.cmsfree/meta.json` (the **base**: `{commit, tree, files: {path: blobSha}}` from the last pull/publish). Boot: no meta -> pull; else if the branch head differs from the base commit -> pull silently when nothing is unpublished, otherwise set `state.remoteChanged` (orange ↓ plus a status note). `checkRemote` in `cms.ts` polls the head every 60 s with a token (5 min without) and on tab focus. **Pull** (↓, `runPull`): fetch the head; unpublished edits to files GitHub did not change are kept, a file changed on both sides asks (`confirm()`: take GitHub's version or cancel). `gh()` fetches with `cache: 'no-store'` (GitHub sends max-age=60). Pull replaces the local site files entirely. Only `isSitePath` files are pulled, compared and published; `hugo.toml` is never changed. **Push** (↑, `runPublish` in `cms.ts`): flush, changed = files whose git blob SHA differs from the base; if the head moved, a changed path whose head SHA differs from the base SHA is a conflict; otherwise blobs -> tree (`base_tree`) -> commit -> `PATCH ref` with `force:false`; update meta; poll `actions/runs?head_sha=` every 5 s. The Hugo site can sit in a repo folder (setting `subdir`, "Site folder"): `github.ts` maps repo paths `<subdir>/<site path>` to site paths on read and back on publish, so OPFS, the model and meta only hold site paths. A non-empty subdir is appended to the OPFS folder name.
- **Folder mode:** a local clone of the site repo (the Hugo site root, with `hugo.toml`) picked via FSA; the handle is kept in IndexedDB (permission is re-granted by a user gesture). Autosave writes there. No ↓ / ↑ buttons.

Site identity: owner/repo are detected on `*.github.io`, otherwise set in the settings dialog. Settings (owner, repo, branch, subdir, token) live in localStorage `cmsfree:github:<host[/repo]>`. `checkSettings` (`github.ts`) checks them on GitHub (repo, token, branch, `hugo.toml` in the site folder, blocks) when the dialog saves and when a setup link is opened; problems mark the dialog fields. A pull without `hugo.toml` in the site folder fails (`NoSiteError`) instead of returning nothing.

Setup link: the settings dialog builds `<page>?edit#cmsfree=<base64url JSON of owner, repo, branch, subdir, token>` ("Copy setup link"). On boot `importSetupLink()` stores those settings for the site, forces browser mode and strips the fragment from the address bar and history. The fragment never reaches a server, but base64 is not encryption: the link is as secret as the token.

### Editing on the page

`page.ts` pairs `cms:KEY` comments with the next `/cms` comment of the same parent (a range). Block ranges get a pencil in an absolutely positioned overlay; double-click inside any range opens its editor `<dialog>`. Re-render replaces the nodes between the markers using a `<template>` (so `<li>` parses). `store.ts` `detectSite()` sets `state.langs` (the `[languages.<lang>]` tables of `hugo.toml`; [] on a one-language site) and `state.defaultLang` (from `hugo.toml`, default `en`). The page language (`initLang`) is the last directory of `location.pathname` if it is in `state.langs`, else the default language. Paths: `blockPath(lang, name)` and `stringsPath(lang)` in `store.ts`. Lookup of a key (`lookup` in `page.ts`): blocks only in the page's language; strings in the page's language, then the default language. Edits always write into the page's own language. Edits go through `store.setFile()` -> autosave after 1 s (only changed files). `beforeunload` warns only while a save is pending.

### Module boundaries

- `state.ts` imports nothing: shared singleton, model `Map<path, text>`, types, constants.
- `disk.ts`: IndexedDB handle store, OPFS root, raw read/write/list/remove relative to `state.root`.
- `format.ts`: pure (above).
- `store.ts`: load model, language detection, file paths, autosave, base comparison, status line.
- `github.ts`: settings + dialog, `gh()`, pull, publish, build polling. No storage access; callers pass data in and out.
- `page.ts`: marker ranges, pencils, editor, Texts panel, re-render.
- `chrome.ts`: injected `cms-` CSS (sites ship no cms CSS), bar, dialog helper, launcher, edit-mode entry/exit. It gets its button handlers through the injected `barActions` object so it never imports store/github/page.
- `cms.ts`: boot and wiring (mode choice, pull/resync, publish).

## Code style

- Codified in `.prettierrc`. English identifiers and comments.
- The engine is content-agnostic: `src/` must never hardcode anything about a specific site. `samples/example-site/` and `samples/example-site-multilingual/` are sample data, not part of the engine.
