# cmsfree ✎

**A tiny CMS with no backend.** Edit your static site in the browser. Your edits are plain Markdown files in your site's GitHub repo; the site's own build renders and deploys them.

Add `?edit` to any page and a dormant script (`cms.js`) wakes up, loads the site's `content/` files and turns the live page into an editor. Without `?edit` it does nothing.

```
your-site/
  www/index.html            template with ##placeholders##
  www/public/cms.js         the cmsfree editor (this repo's dist/cms.js)
  content/<lang>/NAME.md    Markdown blocks
  content/<lang>/site.yml   short strings
```

See [docs/FORMAT.md](docs/FORMAT.md) for the format and the edit markers.

## Storage modes

- **Browser** (default): edits live in the browser (OPFS), synced with the GitHub repo. **Publish** makes one commit; your site's build deploys it.
- **Folder** (Chromium only): pick a local clone of the site repo. Edits are written there; commit with git.

## Try the example

```bash
npm install
npm run dev            # renders example-site and serves it at http://localhost:5173/en/
```

Open **http://localhost:5173/en/?edit** and choose **Use local folder**, then pick `example-site/`. Edits are written to `example-site/content/`; run `npm run build:example` to render them.

```bash
npm run build          # bundle the editor -> dist/cms.js (copy it into a site's www/public/)
npm run preview        # serve example-site/dist on a plain static server
```

---

_Made for people who want to edit their own site without a dashboard, an account, or a backend._
