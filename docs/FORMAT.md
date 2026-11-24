# Content format

One template, content in `content/`. A folder under `content/` is one page. Same format as `unfolding.pt`, which uses the same fallback rule (its shared strings live in `content/site.yml`).

```
www/index.html            the template, with ##placeholders##
cms.js                    the cmsfree editor (copy of cmsfree dist/cms.js)
content/NAME.md           root content: Markdown blocks (exact, case-sensitive names)
content/site.yml          root content: short strings, one "key: text" line each
content/<dir>/NAME.md     content of the page at /<dir>/ (en, de, summer, ...)
content/<dir>/site.yml
```

The site's own build renders `www/index.html` once per page. cmsfree only edits the files under `content/`. See `example-site/` (flat) and `example-site-multilingual/`.

## Pages

- **No subfolders in `content/`**: one page, `/index.html`, rendered from the root content.
- **Subfolders in `content/`**: one page per folder, `/<dir>/index.html`. Fallback is hierarchical: a key that is missing in `content/<dir>/` comes from its parent folder, and so on up to `content/`.
- `/index.html` is then a small redirect page. It goes to the folder that matches `navigator.languages` (first 2 letters or the full name equal to a folder name), else to the default folder (build option `--default <dir>`, else the first folder alphabetically). Without JS, a meta refresh goes to the default folder. The page also lists a link to every folder.

## Placeholders

| Placeholder         | Source                              | Output                                           |
| ------------------- | ----------------------------------- | ------------------------------------------------ |
| `##NAME.md##`       | `content/<dir>/NAME.md`, else `content/NAME.md` | Markdown (`marked`, gfm) as HTML, trimmed |
| `##NAME.md:items##` | same file, split at `### ` headings | `<li><div>…</div></li>` per part, joined by `\n` |
| `##lower_key##`     | `site.yml` key (`^[a-z0-9_]+$`)     | HTML-escaped text                                |
| `##DIR##`           | built-in                            | folder name of the page (`''` on a flat site)    |
| `##DIR_LINKS##`     | built-in                            | links to every folder page, `''` on a flat site  |

`##DIR_LINKS##` renders `<a href="../<dir>/"><dir></a>`, the current page as `<span aria-current="true"><dir></span>`, separated by `<span aria-hidden="true">|</span>`. Built-ins are not editable.

## Asset paths

Write the template relative to the **site root** (`css/site.css`, `cms.js`). A folder page is one level deeper, so the builder puts `../` in front of every relative `src` and `href` value. It skips values that start with `/`, `#`, `../`, `http:`, `https:`, `//`, `data:`, `mailto:` or `tel:`, and values that hold a placeholder.

## site.yml

One `key: text` line per string. Comments (`#`) and blank lines are allowed. Put the value in double quotes if it contains `: ` or ` #`, or starts with a YAML character such as `-`, `[`, `&` or `'`.

## Edit markers

The build wraps editable output in HTML comments so `cms.js` can find it:

```html
<!--cms:WELCOME.md-->…rendered HTML…<!--/cms-->
<!--cms:SERVICES.md:items--><li>…</li><!--/cms-->
<!--cms:menu_home-->Home<!--/cms-->
```

- Blocks are always wrapped.
- Strings are wrapped only in text context. There is no marker inside a tag (attribute values such as `alt`, `content`) or directly inside `<title>`, `<textarea>`, `<script>`, `<style>`. Those strings change on the page only after the next build.
- Built-ins are never wrapped.
- `cms.js` takes the page folder from the URL: the last directory of `location.pathname` if it is a folder of `content/`, else the root (`/site-x/de/` is `de`, `/` is the root page).

### Lookup in the editor

For a key on the page, `cms.js` reads:

1. `content/<dir>/…` (`content/…` on the root page)
2. each parent folder in turn, up to `content/…` (the root)

Editing a key that came from a fallback writes it into the page's own folder (the file is created, or the key is added to its `site.yml`). The Texts panel lists the blocks that have a marker on the page, and the keys of the page's `site.yml` plus those of its parent folders up to `content/`, with the inherited value as placeholder.

## Loader

Load the editor with this loader before `</body>`. It adds `cms.js` only with `?edit` or in a browser that has edited before (`cms.js` sets `localStorage["cmsfree:editor"]`, which also shows the re-entry pencil). Visitors never download the editor.

```html
<script>
  try {
    if (new URLSearchParams(location.search.toLowerCase()).has('edit') || localStorage.getItem('cmsfree:editor') === '1') {
      const cms = document.createElement('script');
      cms.src = '../cms.js';
      document.body.append(cms);
    }
  } catch {}
</script>
```

The builder does not rewrite paths inside scripts. The loader needs a path that is right for the page: `cms.js` on the root page, `../cms.js` on a folder page. A template used for both kinds of page can pick it in JS, for example from `document.documentElement.dataset` set by `##DIR##`. `unfolding.pt` uses `../cms.js` because all its pages live in folders.

A plain `<script src="cms.js"></script>` also works (the example sites use it; the builder turns it into `../cms.js` on folder pages, and the dev server can swap in `src/cms.ts`), but every visitor then downloads the editor.

## Building

```
node scripts/build-site.mjs <siteDir> [--default <dir>]
```

Reads `<siteDir>/www/index.html` and `<siteDir>/content/`, copies the rest of `www/` and `cms.js` to `<siteDir>/dist/`, and renders with edit markers on. It fails with a message on a missing placeholder.

## Editing

Add `?edit` to a page URL.

- **Browser mode**: edits live in the browser (OPFS). The site repo is pulled from GitHub. **Publish** makes one commit; the site's build deploys it.
- **Folder mode** (Chromium): pick a local clone of the site repo. Edits are written there. Commit with git.

Both modes autosave 1 s after a change.
