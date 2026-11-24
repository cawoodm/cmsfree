# Content format (v3)

A site is a plain [Hugo](https://gohugo.io) site. There is no custom build script. cmsfree ships three Hugo partials that wrap editable output in markers, and `cms.js`, the editor.

```
hugo.toml
layouts/home.html                  the page template
layouts/alias.html                 root redirect page (multilingual sites only)
layouts/_partials/cms-block.html   shipped by cmsfree (copy from hugo/layouts/_partials/)
layouts/_partials/cms-items.html   shipped by cmsfree
layouts/_partials/cms-text.html    shipped by cmsfree
content/blocks/NAME.md             single-language site: Markdown blocks, no front matter
content/<lang>/blocks/NAME.md      multilingual site: one folder per language
i18n/<lang>.yaml                   strings, one "key: text" line each
static/cms.js                      the editor (copy of cmsfree dist/cms.js)
```

See `example-site/` (one language) and `example-site-multilingual/` (en + de, default en). Hugo 0.147 or newer.

## hugo.toml

Needed in every site:

```toml
disableHugoGeneratorInject = true
defaultContentLanguage = "en"
disableKinds = ["section", "taxonomy", "term", "rss", "sitemap", "404"]

# Blocks are data for the partials, not pages.
[[cascade]]
[cascade.build]
render = "never"
list = "never"
[cascade.target]
path = "/blocks/**"

# Same HTML as marked (gfm) in cms.js.
[markup.goldmark.parser]
autoHeadingID = false
[markup.goldmark.extensions.typographer]
disable = true
[markup.goldmark.renderer]
unsafe = true
```

A multilingual site adds `defaultContentLanguageInSubdir = true` and one table per language:

```toml
[languages.en]
contentDir = "content/en"
[languages.de]
contentDir = "content/de"
```

Do not use `--minify`: it strips the markers. The editor reads `defaultContentLanguage` from `hugo.toml` (regex, read-only; Hugo's default is `en`).

## Partials

| Template                                   | Output                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `{{ partial "cms-block.html" "NAME.md" }}` | the block as HTML (Hugo goldmark), trimmed                                           |
| `{{ partial "cms-items.html" "NAME.md" }}` | the block split at `### ` headings: `<li><div>…</div></li>` per part, joined by `\n` |
| `{{ partial "cms-text.html" "key" }}`      | the string `key`, HTML-escaped                                                       |
| `{{ T "key" }}` (plain Hugo)               | the string in an attribute, `<title>` or `<script>`; no marker                       |

A `cms-items` block must start with a `### ` heading. A missing block or string stops the build with an error.

Use `cms-text` only in text context. Inside a tag or directly inside `<title>`, `<textarea>`, `<script>`, `<style>` a comment would show as text, so use `T` there. Those strings change on the page only after the next build.

Language links: loop over `.AllTranslations` (see `example-site-multilingual/layouts/home.html`). Asset URLs: `relURL`, `absURL` or resource `.RelPermalink`.

## Languages and fallback

- A single-language site keeps blocks in `content/blocks/` and strings in `i18n/<defaultContentLanguage>.yaml`.
- A multilingual site has `content/<lang>/blocks/` and `i18n/<lang>.yaml` per language, and builds `/<lang>/`.
- Fallback: a block or string missing in a page's language comes from the **default content language**. There is no other fallback (no shared root folder).
- A string key must not be named `description`, `other`, `one` or another go-i18n message field: Hugo then reads the whole file as one message. Use `meta_description`.

`i18n/<lang>.yaml` is flat: one `key: text` line per string. Comments (`#`) and blank lines are allowed. Put the value in double quotes if it contains `: ` or ` #`, or starts with a YAML character such as `-`, `[`, `&` or `'`.

## Root page of a multilingual site

With `defaultContentLanguageInSubdir = true` Hugo renders `layouts/alias.html` at `/`. The example keeps the 2.0 behaviour: JS goes to the language folder that matches `navigator.languages` (first 2 letters or the full name), else to the default language, and keeps `?edit` and the hash. Without JS a meta refresh goes to the default language. The page links to every language.

## Edit markers

The partials wrap editable output in HTML comments so `cms.js` can find it on the live page:

```html
<!--cms:WELCOME.md-->…rendered HTML…<!--/cms-->
<!--cms:SERVICES.md:items-->
<li>…</li>
<!--/cms-->
<!--cms:menu_home-->Home<!--/cms-->
```

The markers carry no language. `cms.js` takes the page language from the URL: the last directory of `location.pathname` if it is a language folder (`/de/` is `de`), else the default language.

## Editor rules

- Files the editor loads and edits: `content/**/blocks/*.md` and `i18n/*.yaml`. `hugo.toml` is read only.
- Languages: the folders `content/<lang>/` that contain `blocks/`. If `content/blocks/` exists instead, the site is single-language.
- Lookup of a key: the page's language, then the default language.
- Editing a key that came from the default language writes into the page's own language: the block file is created, or the key is added to `i18n/<lang>.yaml`.
- The Texts panel lists the blocks that have a marker on the page and the strings of the page's language plus the default language's (as placeholder).
- Browser mode pulls and publishes `content/**`, `i18n/**` and `hugo.toml` (never changed).
- A re-render in the browser uses `marked` (gfm) and the same items split as `cms-items.html`.

## Loader

`cms.js` stays dormant without `?edit`. The examples load it with a plain `<script src="{{ "cms.js" | relURL }}"></script>`, which every visitor downloads. To load it only for editors, add it from JS when the URL has `?edit` or `localStorage["cmsfree:editor"]` is set (the editor sets it, and shows a re-entry pencil):

```html
<script>
  try {
    if (new URLSearchParams(location.search.toLowerCase()).has('edit') || localStorage.getItem('cmsfree:editor') === '1') {
      const cms = document.createElement('script')
      cms.src = '{{ "cms.js" | relURL }}'
      document.body.append(cms)
    }
  } catch {}
</script>
```

## Building and editing

```
hugo -s <siteDir> -d <siteDir>/dist
```

The site's own build (for example GitHub Actions running Hugo) deploys it.

Add `?edit` to a page URL.

- **Browser mode**: edits live in the browser (OPFS). The site repo is pulled from GitHub. **Publish** makes one commit; the site's build deploys it.
- **Folder mode** (Chromium): pick the local clone of the site repo (the folder with `hugo.toml`). Edits are written there. Commit with git.

Both modes autosave 1 s after a change. The repo root must be the Hugo site root.
