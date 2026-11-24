# Content format

One template, one folder per language. Same format as `unfolding.pt`.

```
www/index.html            the template, with ##placeholders##
www/public/cms.js         the cmsfree editor (copy of cmsfree dist/cms.js)
content/<lang>/NAME.md    Markdown blocks (exact, case-sensitive names)
content/<lang>/site.yml   short strings, one "key: text" line each
```

The site's own build renders `www/index.html` once per language. cmsfree only edits the files under `content/`.

## Placeholders

| Placeholder        | Source                              | Output                                         |
| ------------------ | ----------------------------------- | ---------------------------------------------- |
| `##NAME.md##`      | `content/<lang>/NAME.md`            | Markdown (`marked`, gfm) as HTML, trimmed      |
| `##NAME.md:items##`| same file, split at `### ` headings | `<li><div>…</div></li>` per part, joined by `\n` |
| `##lower_key##`    | `site.yml` key (`^[a-z0-9_]+$`)     | HTML-escaped text                              |
| `##UPPER##`        | built-in                            | not editable (`LANG`, `LANG_SWITCH`)           |

Languages are the folders under `content/`. The first one (`en` if present) is the fallback: a block or key missing in another language uses the fallback content.

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
- The key has no language. `cms.js` uses `<html lang>` and the fallback.

Load the editor with this loader before `</body>` (pages live at `/<lang>/index.html`). It adds `cms.js` only with `?edit` or in a browser that has edited before (`cms.js` sets `localStorage["cmsfree:editor"]`, which also shows the re-entry pencil). Visitors never download the editor.

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

A plain `<script src="../cms.js"></script>` also works (the example site uses it, so the dev server can swap in `src/cms.ts`), but every visitor then downloads the editor.

## Editing

Add `?edit` to a page URL.

- **Browser mode**: edits live in the browser (OPFS). The site repo is pulled from GitHub. **Publish** makes one commit; the site's build deploys it.
- **Folder mode** (Chromium): pick a local clone of the site repo. Edits are written there. Commit with git.

Both modes autosave 1 s after a change.
