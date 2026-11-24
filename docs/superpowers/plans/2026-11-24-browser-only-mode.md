# cmsfree v2 — unfolding format, browser storage, GitHub publish

This replaces cmsfree's own content model (sections, pages, blocks, posts,
`content/template.html`, in-browser Publish, `publish/`). There is **one
format**: the one `../unfolding.pt` uses. The site's own build (GitHub Actions)
renders and deploys. cmsfree is only the editor: `cms.js` on the live page,
browser storage, and a GitHub commit.

## 1. The format

```
www/index.html            the one template, ##placeholders##
www/public/cms.js         the cmsfree sleeper (copied from cmsfree dist/cms.js)
content/<lang>/NAME.md    Markdown blocks (exact, case-sensitive names)
content/<lang>/site.yml   short strings, one "key: text" line each
.github/workflows/…       the site's build + Pages deploy
```

Placeholders:

| Placeholder | Source | Output |
|---|---|---|
| `##NAME.md##` | `content/<lang>/NAME.md` | `marked` (gfm) HTML, trimmed |
| `##NAME.md:items##` | same file, split at `### ` | `<li><div>…</div></li>` per part, joined by `\n` |
| `##lower_key##` | `site.yml` key (`^[a-z0-9_]+$`) | HTML-escaped text |
| `##UPPER##` | built-in (site-defined) | not editable |

Languages are the folders under `content/`. The first language (`en`) is the
fallback: a block or key missing in another language uses the `en` content.

### Edit markers (new)

The renderer wraps editable output in HTML comments, so `cms.js` can find it
on the live page:

```html
<!--cms:WELCOME.md-->…rendered HTML…<!--/cms-->
<!--cms:SERVICES.md:items--><li>…</li><!--/cms-->
<!--cms:menu_home-->Home<!--/cms-->
```

- Blocks are always wrapped.
- Strings are wrapped only in **text context**. No marker when the
  placeholder is inside a tag (an attribute value: the last `<` before it is
  after the last `>`), or directly inside `<title>`, `<textarea>`, `<script>`
  or `<style>` (raw text: a comment would show as text).
- Built-ins are never wrapped.
- The key in the marker has no language. `cms.js` resolves it against the
  page language (`<html lang>`), with the `en` fallback.

`cms.js` is loaded from the template with a plain
`<script src="../cms.js"></script>` before `</body>` (pages live at
`/<lang>/index.html`).

## 2. Editor (`cms.js`)

Dormant unless the URL has `?edit`. View mode keeps the small re-entry pencil
for returning editors.

### Storage modes

- **Browser (default):** OPFS, `navigator.storage.getDirectory()` →
  `sites/<owner>__<repo>__<branch>/`. Holds `content/**` and
  `.cmsfree/meta.json` (the **base**: `{ commit, tree, files: {path: blobSha} }`
  from the last pull or publish). Call `navigator.storage.persist()`.
- **Folder:** File System Access, the user picks a local clone of the site
  repo (the folder with `content/`). Save writes there. No Publish button: the
  user commits with git. Useful with the site's dev server (it reloads on a
  content change).

The mode is chosen once per site (buttons in the bar when FSA exists;
browser mode otherwise) and stored in localStorage.

### Site identity and settings

- `siteId`: on `<owner>.github.io/<repo>/…` → owner and repo come from the
  URL. Elsewhere (custom domain, localhost) → from settings.
- Settings (owner, repo, branch = `main`, token) are stored in localStorage
  under `cmsfree:github:<siteId-key>` where the key is `location.host` plus,
  on `*.github.io`, the first path segment. Several sites on one origin do not
  mix.
- Token is optional for pull (public repo); Publish needs it.

### Boot (browser mode)

1. Settings complete? If not, open the settings dialog and wait.
2. Open the OPFS site folder. No `meta.json` → **pull**.
3. Else get the branch head (best effort). Head ≠ base commit:
   - no unpublished local changes → pull silently;
   - else `confirm()`: discard local changes and re-sync? (Cancel keeps them;
     Publish merges if the files do not overlap.)
4. Load the model: every file under `content/` → `Map<path, text>`.
5. Bind the page (below).

**Pull:** ref → commit → recursive tree → blobs for paths under `content/` →
replace the local `content/` folder entirely → write `meta.json`.

### Editing on the page

- Walk the DOM comments; pair each `cms:KEY` with the next `/cms` that has the
  same parent. Each pair is a **range**.
- Blocks: a small ✎ button (overlay layer, positioned from
  `Range.getBoundingClientRect()`, recomputed on resize, after a re-render and
  every 1 s) opens the editor. Hidden when the rect is empty (closed dialog).
  Double-click inside any range also opens its editor.
- Editor: a `<dialog>` with a Markdown `<textarea>`, OK / Cancel, Ctrl+Enter =
  OK, Esc = Cancel. If the block falls back to `en`, a note says "No <lang>
  text yet — OK creates content/<lang>/NAME.md".
- OK → `model.set()`, re-render every range with that key (parse via a
  `<template>` element so `<li>` works), schedule autosave.
- **Texts panel** (bar button): every block (opens the editor) and every
  `site.yml` key of the page language as an input (shows the `en` value as
  placeholder when missing). Change → update the `site.yml` line in place
  (keep order and comments; add the key at the end if new), re-render the
  string ranges. Attribute strings (alt, title, meta) change only after the
  build — the panel says so.
- Language links (`a[hreflang]`) keep `?edit`.

### Autosave and status

- No Save button. Any change autosaves the changed files after 1 s.
  `beforeunload` warns only while a save is pending.
- Status line: "N unpublished changes" (browser mode: model files whose git
  blob SHA differs from the base) or "Saved to folder" (folder mode).

### Publish (browser mode)

1. Flush autosave. Changed = files whose blob SHA ≠ `meta.files[path]`.
   None → "Nothing to publish".
2. Head ≠ base commit → read the head tree. A changed path whose head SHA ≠
   base SHA is a **conflict** → stop, list the files, offer re-sync. Otherwise
   build on the head.
3. `POST git/blobs` per changed file (utf-8) → `POST git/trees` with
   `base_tree` → `POST git/commits` (message `Edit content: <files>`) →
   `PATCH git/refs/heads/<branch>` with `force: false`.
4. Update `meta.json` with the new commit, tree and SHAs.
5. Poll `GET actions/runs?head_sha=<sha>` every 5 s (max 10 min): "Building…",
   "Live — reload to see it" (link), "Build failed" (link to the run).

Git blob SHA = SHA-1 of `"blob " + byteLength + "\0" + utf8Bytes`.

## 3. cmsfree repo layout after the change

```
src/
  cms.ts       boot, wiring
  state.ts     shared state, model, types (imports nothing)
  disk.ts      FSA + IDB handle store + OPFS root, read/write/list/remove
  format.ts    pure: marked, renderBlock, renderItems, escapeHtml, markers,
               parseStrings, setString, renderPage (for the example build)
  store.ts     loadModel, autosave, changed files vs base
  github.ts    settings + dialog, gh(), blobSha, pull, publish, build status
  page.ts      marker ranges, pencils, editor dialog, Texts panel, re-render
  chrome.ts    bar, status, launcher, injected edit CSS
example-site/
  www/index.html, www/css/site.css
  content/en/*.md + site.yml, content/de/ (partial, shows the fallback)
scripts/build-example.mjs   renders example-site → example-site/dist
dist/cms.js                 the build artifact sites copy into www/public/
```

Removed: sections/pages/blocks/posts model, routes, router, CRUD, in-browser
Publish, `publish/`, `scripts/publish-content.mjs`, `publish-entry.ts`,
`publish.ps1`, `content/template.html`, `manifest.json`, `version.json`.

`npm run dev` builds the example and serves `example-site/dist` with Vite,
swapping `../cms.js` for `src/cms.ts`. `npm run build` writes `dist/cms.js`.

## 4. unfolding.pt changes

- `scripts/build-content.mjs`: `renderPage(…, { markers })` option (default
  `false`, so the existing exact-output tests pass); `renderLanguage` passes
  `markers: true`. New tests for markers and the context rules.
- `www/index.html`: `<script src="../cms.js"></script>` before `</body>`.
- `www/public/cms.js`: copy of cmsfree `dist/cms.js`.
- `content/README.md`, `CLAUDE.md`, `docs/BUILD.md`: browser editing and the
  markers.

## 5. Open points

- The renderer exists twice (cmsfree `format.ts`, unfolding
  `build-content.mjs`). Later: publish cmsfree's renderer as a package and let
  sites import it.
- Images and other binary assets are not editable yet.
