# Content format (v3)

A site is a plain [Hugo](https://gohugo.io) site. There is no custom build script. cmsfree ships three Hugo partials that wrap editable output in markers, and `cms.js`, the editor.

```
hugo.toml
layouts/home.html                  the page template
layouts/alias.html                 root redirect page (multilingual sites only)
layouts/_partials/cms-block.html   shipped by cmsfree (copy from hugo/layouts/_partials/)
layouts/_partials/cms-items.html   shipped by cmsfree
layouts/_partials/cms-text.html    shipped by cmsfree
layouts/_markup/render-link.html   shipped by cmsfree: keeps tel: links (Hugo's default turns them into #ZgotmplZ)
content/blocks/NAME.md             Markdown block in the default (or only) language, no front matter
content/blocks/NAME.<lang>.md      the same block in another language (Hugo: translation by file name)
i18n/<lang>.yaml                   strings, one "key: text" line each
static/cms.js                      the editor (copy of cmsfree dist/cms.js)
```

See `samples/example-site/` (one language) and `samples/example-site-multilingual/` (en + de, default en). Hugo 0.147 or newer.

## hugo.toml

Needed in every site:

```toml
disableHugoGeneratorInject = true
# Page-relative links and assets (../css/…): the site works from the domain root and from a subfolder.
relativeURLs = true
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

A multilingual site adds `defaultContentLanguageInSubdir = true` and one table per language. Keep Hugo's default layout: no `contentDir`, no `i18nDir` (the editor uses `content/` and `i18n/`).

```toml
[languages.en]
languageName = "English"
[languages.de]
languageName = "Deutsch"
```

Do not use `--minify`: it strips the markers. The editor reads `defaultContentLanguage` (Hugo's default is `en`) and the `[languages.<lang>]` table names from `hugo.toml` (regex, read-only).

## Partials

| Template                                   | Output                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `{{ partial "cms-block.html" "NAME.md" }}` | the block as HTML (Hugo goldmark), trimmed                                           |
| `{{ partial "cms-items.html" "NAME.md" }}` | the block split at `### ` headings: `<li><div>…</div></li>` per part, joined by `\n` |
| `{{ partial "cms-text.html" "key" }}`      | the string `key`, HTML-escaped                                                       |
| `{{ T "key" }}` (plain Hugo)               | the string in an attribute, `<title>` or `<script>`; no marker                       |

A `cms-items` block must start with a `### ` heading. A missing block or string stops the build with an error.

Use `cms-text` only in text context. Inside a tag or directly inside `<title>`, `<textarea>`, `<script>`, `<style>` a comment would show as text, so use `T` there. Those strings change on the page only after the next build.

Language links: loop over `.AllTranslations` (see `samples/example-site-multilingual/layouts/home.html`). Asset URLs: `relURL` or resource `.RelPermalink`. With `relativeURLs = true` Hugo turns every local `href`, `src` and `srcset` into a page-relative path (`/de/` becomes `../de/` on `/en/`), so the same build works at `https://example.org/` and at `https://user.github.io/repo/`. Keep canonical and `hreflang` links absolute (`.Permalink`, `absURL`). Hugo does not rewrite URLs inside `<script>`: compute those yourself (see Loader).

## Languages and fallback

- Blocks live in `content/blocks/` for every site. The default language (or the only one) uses `NAME.md`, another language `NAME.<lang>.md` (`HERO.de.md`). Strings are `i18n/<lang>.yaml` per language. A multilingual site builds `/<lang>/`.
- Blocks have **no fallback**: every language needs every block it uses. A missing block stops the build with the expected path (`de: no block HERO.md (expected content/blocks/HERO.de.md)`).
- Strings fall back to the **default content language**: Hugo's `T` does this and it cannot be turned off. There is no other fallback (no shared root folder).
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

- Files the editor loads and edits: `content/blocks/*.md` and `i18n/*.yaml`. `hugo.toml` is read only.
- Languages: the `[languages.<lang>]` tables of `hugo.toml`. None = single-language site.
- Lookup of a block: the page's language only. Lookup of a string: the page's language, then the default language (as `T`).
- Editing a missing block creates its file in the page's language. Editing a string that came from the default language adds the key to the page's `i18n/<lang>.yaml`.
- The Texts panel lists the blocks that have a marker on the page and the strings of the page's language plus the default language's (as placeholder).
- Browser mode pulls and publishes `content/blocks/*.md`, `i18n/*.yaml` and `hugo.toml` (never changed).
- A re-render in the browser uses `marked` (gfm) and the same items split as `cms-items.html`.

## Loader

`cms.js` stays dormant without `?edit`. The examples load it with a plain `<script src="{{ "cms.js" | relURL }}"></script>`, which every visitor downloads. To load it only for editors, add it from JS when the URL has `?edit` or `localStorage["cmsfree:editor"]` is set (the editor sets it, and shows a re-entry pencil):

```html
<script>
  try {
    if (new URLSearchParams(location.search.toLowerCase()).has('edit') || localStorage.getItem('cmsfree:editor') === '1') {
      const cms = document.createElement('script')
      // One "../" per folder level of the page (/en/ -> ../cms.js): relativeURLs does not rewrite script strings.
      cms.src = '{{ strings.Repeat (len (findRE `/` (strings.TrimPrefix `/` .RelPermalink))) `../` | safeJS }}cms.js'
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

- **Browser mode**: edits live in the browser (OPFS). The site repo is pulled from GitHub. **↑ Push** makes one commit; the site's build deploys it. **↓ Pull** brings in newer commits (it turns orange when GitHub has some) and keeps your unpublished edits to files that did not change there.
- **Folder mode** (Chromium): pick the local clone of the site repo (the folder with `hugo.toml`). Edits are written there. Commit with git.

Both modes autosave 1 s after a change. The repo root must be the Hugo site root.
