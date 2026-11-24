# cmsfree ✎

**A tiny CMS with no backend.** Edit your static site in the browser. Your edits are plain Markdown files in your site's GitHub repo; the site's own build renders and deploys them.

Add `?edit` to any page and a dormant script (`cms.js`) wakes up, loads the site's `content/` files and turns the live page into an editor. Without `?edit` it does nothing.

```
your-site/
  www/index.html            template with ##placeholders##
  www/cms.js                the cmsfree editor (this repo's dist/cms.js)
  content/NAME.md           Markdown blocks (root content)
  content/site.yml          short strings
  content/<dir>/...         optional: one folder per page (en, de, summer, ...)
```

Without subfolders the site is one page. With subfolders each folder is a page at `/<dir>/`, the root files are shared defaults, and `/` redirects to the folder that matches the browser language.

See [docs/FORMAT.md](docs/FORMAT.md) for the format and the edit markers.

## Storage modes

- **Browser** (default): edits live in the browser (OPFS), synced with the GitHub repo. **Publish** makes one commit; your site's build deploys it.
- **Folder** (Chromium only): pick a local clone of the site repo. Edits are written there; commit with git.

## Try the example

```bash
npm install
npm run dev                  # renders both examples, serves example-site at http://localhost:5173/
npm run dev:multilingual     # serves example-site-multilingual (/en/, /de/)
```

Open **http://localhost:5173/?edit** (multilingual: **/en/?edit**) and choose **Use local folder**, then pick `example-site/` (or `example-site-multilingual/`). Edits are written to its `content/`; run `npm run build:examples` to render them.

```bash
npm run build          # bundle the editor -> dist/cms.js (copy it into a site)
npm run preview        # serve example-site/dist on a plain static server
```

---

_Made for people who want to edit their own site without a dashboard, an account, or a backend._
