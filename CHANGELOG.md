# Changelog

## 3.2.0 (2026-11-25)

- The built `cms.js` starts with a version comment: `/* CMSFree v3.2.0 */`.

## 3.1.0 (2026-11-25)

### Fixed

- **No block fallback.** A block missing in a page's language no longer shows the default-language (English) block. It fails the build and names the expected file, e.g. `de: no block HERO.md (expected content/de/blocks/HERO.md)`. Copy the new `cms-block.html` and `cms-items.html` into your site.
- The editor looks up blocks only in the page's language. Strings still fall back to the default language, because Hugo's `T` does that.
- The multilingual example has its German `ABOUT.md` block again.

## 3.0.0 (2026-11-24)

Sites are now plain Hugo sites. There is no custom build script and no `##placeholder##` template. Breaking change: sites in the 2.0 format must be converted (`docs/FORMAT.md`).

### Breaking

- **Hugo instead of `scripts/build-site.mjs`.** The page template is `layouts/home.html`. Three partials shipped in `hugo/layouts/_partials/` (`cms-block.html`, `cms-items.html`, `cms-text.html`) output the same edit markers as before: `<!--cms:KEY-->…<!--/cms-->`.
- **New file layout.** Blocks: `content/blocks/NAME.md` (one language) or `content/<lang>/blocks/NAME.md`. Strings: `i18n/<lang>.yaml` (was `site.yml`). Static files: `static/`.
- **Languages.** Multilingual sites use one Hugo `contentDir` per language. The default language is `defaultContentLanguage` in `hugo.toml`.
- **Fallback.** A block or string missing in a language comes from the default language. The shared root content is gone: move root `site.yml` keys into `i18n/<defaultLang>.yaml` and root blocks into the default language.
- **i18n key names.** A key must not be named `description` (go-i18n reserved word); the examples use `meta_description`.
- **Removed:** `##…##` placeholders and built-ins, `scripts/build-site.mjs`, `renderPage` and `prefixRelativeUrls` in `src/format.ts`, `--default`.

### Changed

- **Editor.** `cms.js` loads `content/**/blocks/*.md`, `i18n/*.yaml` and `hugo.toml` (read only, for the default language). The page language comes from the URL, lookup is own language then default language, edits go to the own language. Browser mode pulls and publishes the same file set.
- `npm run build:examples` runs `hugo` for both examples (`scripts/build-examples.mjs`) and copies `dist/cms.js` into each output. Hugo must be on the PATH.
- The Vite dev swap matches any `<script src="…cms.js">`.
- **Dialogs.** Esc or a click outside closes every dialog; Ctrl/Cmd+Enter clicks its main button (OK, Save, Close). The Texts panel keeps a just-typed string when it closes this way.
- **No blocks.** If a page in edit mode has no block markers (no pencils), an error dialog names the likely causes: a cached old page, a build without the cms partials or with `--minify`.
- Hugo link render hook `hugo/layouts/_markup/render-link.html` keeps `tel:` links.
- **Relative URLs.** The examples and `docs/FORMAT.md` use `relativeURLs = true`, so a site works from the domain root and from a subfolder (`user.github.io/repo/`). The multilingual root redirect and the editor loader use relative paths too.

## 2.0.0 (2026-11-24)

cmsfree is now only an editor. The site's own build (e.g. GitHub Actions) renders and deploys the pages. cmsfree edits the files under `content/` in the browser and commits them to GitHub. This is a breaking change: sites in the 1.x format do not work with 2.0.

### Breaking

- **New content format** (`docs/FORMAT.md`). One template, `www/index.html`, with `##placeholders##`. Text lives in `content/`:
  - `##NAME.md##` is the Markdown file `NAME.md`, `##NAME.md:items##` the same file split into `<li>` items at `### ` headings.
  - `##lower_key##` is a string from `site.yml`.
  - `##DIR##` and `##DIR_LINKS##` are built-ins.
- **Content folders.** Files directly in `content/` build one page at `/`. Each `content/<dir>/` builds the page `/<dir>/` instead, and `/` becomes a redirect page. A folder can have any name, not only a language.
- **Hierarchical fallback.** A key missing in `content/<dir>/` comes from the parent folder, up to `content/`. There is no other fallback.
- **Edit markers.** The site build must wrap editable output in `<!--cms:KEY-->…<!--/cms-->` comments, so `cms.js` can find it on the live page.
- **Removed:** sections, pages, blocks and posts with their filename rules, `content/template.html`, `manifest.json`, `version.json`, the in-browser Publish to `publish/`, the Deploy button, `scripts/publish-content.mjs`, `publish.ps1` and `docs/CONCEPTS.md` (the old model; still in git history).

### Added

- **Browser mode.** Drafts are kept in the browser's private file system (OPFS), so no local folder is needed. The first visit pulls `content/` from GitHub.
- **Folder mode.** Edit a local clone through the File System Access API (Chromium only).
- **Autosave.** Changes are saved locally 1 s after an edit. There is no Save button.
- **Publish.** Only the changed `content/` files go to GitHub, in one commit, without force push. If someone else changed the same file, Publish stops and offers a re-sync. After the push the bar shows the build status: Building, Live or Build failed.
- **On-page editing.** A pencil on each block, double-click on any text, an editor dialog, and a Texts panel for all `site.yml` strings.
- **Setup link.** The settings dialog builds a link that carries owner, repo, branch and token, so one click sets up another browser. Keep it private: it contains the token.
- **Loader snippet.** Load `cms.js` only with `?edit` or in a browser that has edited before, so visitors never download the editor.
- **Examples.** `example-site/` (flat) and `example-site-multilingual/` (`en/`, `de/`, shared strings in `content/site.yml`), built with `scripts/build-site.mjs`. `npm run dev` and `npm run dev:multilingual` serve them.

### Build

- `npm run build` writes `dist/cms.js`. Sites copy it to `www/public/cms.js`.
