# cmsfree ✎

**A tiny CMS with no backend.** Edit your static site _in the browser_, save straight to your local disk, publish plain HTML that runs anywhere and even commit the published files to github all from your browser.

Add `?edit` to any page and a dormant script wakes up, connects to your local project folder (via the browser's File System Access API), and turns the live site into an editor. Your content is just markdown files. There's no server, no database, no lock-in — the published site is static HTML you can host on anything (or push to GitHub Pages with one click).

```
your-site/
  content/            ← what you edit (markdown + one template.html + _assets)
    index.md
    about-us/index.md
    services/index.md
  publish/            ← generated static site (deploy this anywhere)
  cms.js              ← the ~20 kB "sleeper" (does nothing until ?edit)
```

## How it works

- **View** — plain static HTML from `publish/`. Zero JavaScript needed; `cms.js` just sleeps.
- **Edit** — visit `?edit`. The CMS reads `content/` **from disk** and rebuilds the page in memory: generated nav, live markdown rendering, inline editing, create/rename/delete sections & pages. Nothing is written until you hit **Save**.
- **Publish** — regenerates `publish/` (one static page per route) from a single `content/template.html`.
- **Deploy** — pushes `publish/` (plus the `content/` source, for cross-machine sync) to GitHub Pages via the GitHub API.

## Content model

A file's role is decided by its name (see [docs/CONCEPTS.md](docs/CONCEPTS.md)):

- **Section** — a folder under `content/` with an `index.md`; published and appears in the nav.
- **Page** — a `name.md` (no leading `_`, no dot in the name); published to its own URL but _not_ in the nav — link to it from content.
- **Block** — a `_name.md`; never published on its own, only `[include]`d into a page.
- **Post** — a `name.part.md` (e.g. `index.blog-1.md`); never published alone, surfaced only inside a list (e.g. a blog index).
- **Hidden** — a `.name.md`; never published (reserved for later use).

Optional frontmatter: `title:`, `slug:`, `order:`. `content/template.html` is the single source of layout for every page. (A leading `_` on a **folder** means a hidden section — still published, just out of the nav — which is different from a `_` on a file.)

## Get started

**Requirements:** Node.js and a Chromium browser (Chrome/Edge — the File System Access API).

```bash
npm install
npm run dev            # dev server with hot-reload (http://localhost:5173)
```

1. Open **http://localhost:5173/?edit**
2. Click **Connect folder** and pick the site root (e.g. `example-site/`)
3. Edit a page (✎), add a section (＋), etc. → **Save** (writes to `content/`)
4. **Publish** → generates `example-site/publish/`

```bash
npm run build          # bundle the CMS → cms.js (after changing src/)
npm run preview        # serve publish/ on a plain static server (any host works)
```

Once you've entered edit mode, a small ✎ pins to the top-left of every page so you can jump back in anytime.

## Deploy to GitHub Pages

In edit mode, open **⚙ Settings**, enter a GitHub token + owner/repo/branch, then hit **Deploy**. It commits **both** `publish/` and your editable `content/` source to the branch in one commit (commit message = your prefix + version). Point GitHub Pages at that branch and you're live.

- `publish/` goes to the branch root, or to the optional **Subdirectory**.
- `content/` goes to the **Content folder** (default `_content/`) so it can be synced back to another machine. A leading-underscore folder is skipped by GitHub Pages' Jekyll and can't collide with a section, so it isn't rebuilt as part of the site.

## Work from a new machine (no clone)

Because Deploy pushes the source too, you can pick up a site on any computer without cloning:

1. Open your live site with `?edit` (this loads `cms.js`), open **⚙ Settings**, and enter owner/repo/branch (a token is only needed for a **private** repo, or to Deploy).
2. Click **Connect folder** and pick an **empty** folder. The CMS notices it's empty and offers **Pull from GitHub** — it downloads `content/` + `publish/` into the folder, then you edit as usual.
3. If you connect a folder that already holds an **older** copy (its `content/version.json` is behind the repo), the CMS offers to **Re-sync**. Re-sync overwrites files that exist on the repo and keeps any local-only files; it never runs when your local copy is the same or newer.

## Under the hood

- `src/` — the CMS engine (TypeScript), bundled by **Vite** into a single self-contained `cms.js`. Vite is only a dev/build tool — **nothing depends on it at runtime**.
- Markdown via [marked](https://github.com/markedjs/marked); everything else is vanilla DOM + the File System Access API.
- The published site uses **relative URLs**, so it works at a domain root, a subpath (GitHub project pages), or straight from `file://`.

---

_Made for people who want to edit their own site without a dashboard, an account, or a backend._
