# Changelog

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
