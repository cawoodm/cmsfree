# cmsfree — Design Spec

## Context

Small business sites are often built once by a developer and then need ongoing content updates (text, hours, prices, a new services page) that shouldn't require a developer, a CMS server, a database, or a deploy pipeline. `cmsfree` is a minimal, backend-less CMS for static sites: a non-technical site owner connects a local folder (via the File System Access API) and edits content directly on disk, in-browser, with no server involved at either read or write time. A developer builds the visual design and page shell once; the CMS engine owns content structure, navigation, routing, and editing from then on.

The goal of this spec is the core CMS engine and its content model — not the specific example bakery site, which exists only as a scaffold to validate the visual direction.

## Architecture

```
/ (project root)
  example-site/                  ← the managed source (edited via the CMS; the FSA-connected folder)
    content/                  ← the managed source (edited via the CMS; the FSA-connected folder)
      index.html          ← developer-built shell: CSS, header/footer, <nav x-cms-nav>, <main x-cms-content>
      cms.js               ← the CMS engine (this project's main deliverable)
      css/, images/        ← developer assets
      content/
        manifest.json      ← auto-generated nav index (see "Manifest" below)
        index.md           ← homepage, not itself a nav item
        <section-slug>/
          index.md         ← section content, shown in nav. Frontmatter: title, order
          <block-slug>.md  ← unlisted page, not in nav, reachable only via manual links in content
    publish/              ← generated static site (output of Publish; deployable)
```

No build step for the source site: Alpine.js, alpine-ajax, marked.js (markdown → HTML), and turndown.js (HTML → markdown) are all loaded via CDN `<script>` tags in `index.html`. (Vite is used as a local dev static server during development and for production bundling step.) The **Publish** action produces `publish/` from `content/` (see "Data flow" and "Publish output").

Editing requires a Chromium-based browser (File System Access API) and is entirely local — no network round-trip for reads or writes once the `content/` folder is connected. Read-only visitors are served the deployed `publish/` output over plain HTTP by any static host.

## Content model

- **Section** = a folder directly under `content/`. Its `index.md` is the section's page content and its presence makes the section appear in the nav.
- **Block** = any other `.md` file inside a section folder. Not shown in nav. Reachable only via a manual markdown link placed in content (e.g. `[Custom Cakes](#/services/custom-cakes)`).
- Folders/files starting with `_` or `.` are ignored entirely (drafts, partials, private content).
- No nesting beyond one level: `content/<section>/` and files directly inside it. No sub-sections.
- **Markdown is the single source of truth on disk**, always. The three editing surfaces (see "Editors" below) are just different ways to author it — none of them changes the stored format.
- Optional YAML-lite frontmatter at the top of any file:

  ```
  ---
  title: About Us
  order: 1
  ---
  ```

  - `title` (section or block): display label. Falls back to the slug, auto-formatted (dashes → spaces, title-cased), if absent.
  - `order` (section only): nav sort position. Falls back to alphabetical-by-title if absent.
  - Parsed with a minimal hand-rolled parser (flat `key: value` lines only) — no full YAML library needed for two fields.
  - Malformed frontmatter falls back to defaults silently; this is not treated as an error.

## Manifest

`content/manifest.json` is a generated, flat list of sections — `[{slug, title, order}, ...]` — containing **sections only** (blocks are never in the nav, so never in the manifest). It is **not** fetched by visitors (the published site has baked-in static nav). It serves two consumers: (1) the **edit-mode nav generator**, which needs the section list because a browser cannot list a directory over HTTP; and (2) the **Publish step**, which reads it to bake the nav into each generated static page.

The CMS engine (in edit mode) regenerates this file wholesale — never incrementally patched — by scanning the top level of `content/` and reading each section's `index.md` frontmatter, whenever:

- a section is created, renamed, or deleted, or
- any `index.md` is saved (in case its frontmatter changed).

Regenerating wholesale each time avoids drift between the manifest and the actual folder structure.

## Routing — EDIT MODE ONLY

Routing is exclusively an edit-mode mechanism. **The published site is static multi-page HTML** (one real file per page, real `<a href>` links, no runtime libraries — only the dormant `cms.js` sleeper). A normal visitor navigates by ordinary page loads; there is no client-side router, no `manifest.json` fetch, no markdown rendering at view time.

When `?edit` is active, the sleeper wakes and takes over navigation as an in-memory SPA. It intercepts internal link clicks and `hashchange`, resolves the route to a `content/` file by pure string logic, reads it via the FSA handle, renders it with marked.js, and injects the result into `<main x-cms-content>`:

- `#/` or empty → `content/index.md` (homepage; not a nav item; reachable via a logo/home link in the shell)
- `#/<section>` → `content/<section>/index.md`
- `#/<section>/<block>` → `content/<section>/<block>.md`

`routeFromAnchor()` normalizes both hash hrefs (`#/about-us`) and real-path hrefs (`/about-us/`, `/services/custom-cakes.html`) to a route, so the same interception works whether the baked nav uses hash or real links; asset/external links (`images/…`, `http…`, `mailto:`) are left to the browser. Save targets the _current_ route's file (`currentPath`), not just the homepage.

## Editors

Content is always markdown on disk. Three authoring surfaces, but only two distinct _mechanisms_, since markdown natively embeds raw HTML:

1. **Source editor** (covers both "markdown" and "raw HTML" authoring) — a plain `<textarea>` bound to the file's raw text (frontmatter + body). Saving writes the textarea value verbatim.
2. **WYSIWYG editor** — the rendered HTML made `contenteditable`. On save, the edited DOM is converted back to markdown via turndown.js. Frontmatter is parsed out before rendering and is never touched by the WYSIWYG round-trip — it's reattached to the turndown output before writing.

The user can toggle live between these two on any file; there is no per-file mode setting.

## Edit mode

- Activated by `?edit` anywhere in the URL.
- On activation, check IndexedDB for a previously-stored `FileSystemDirectoryHandle`.
  - If found: attempt to verify/re-request `readwrite` permission (browsers require a user gesture for this after reload — it cannot be silent).
  - If not found, or permission denied: show a persistent, visible connect prompt. **This is never a silent fallback to read-only** — `?edit` means the user is actively trying to edit, so the UI keeps prompting until access is granted or `?edit` is removed from the URL.
- Once connected, the handle is (re-)persisted to IndexedDB.
- Edit affordances appear: a subtle pencil icon on content areas, a "+" control in the nav for new sections, a "+" control below content for new blocks, and rename/delete icons next to nav items.

## Create / rename / delete

Scope is intentionally limited to **content and structure**, never layout/design — that remains the developer's responsibility in `index.html`/CSS.

- **New section**: `window.prompt()` for a title → slugify → check for collision in the manifest → create `content/<slug>/index.md` with `title`/`order` frontmatter and empty body → regenerate manifest → nav updates immediately.
- **New block**: `window.prompt()` for a title → slugify → check for collision within the current folder → create `content/<section>/<slug>.md` → navigate to it so the user can start editing and copy its `#/...` link to place elsewhere.
- **Rename**: uses the FSA `move()` method where supported; falls back to copy-then-delete where it isn't (needed for folders especially, since FSA has no universal rename primitive).
- **Delete**: a plain `window.confirm()`. Deleting a section recursively deletes everything inside it (via `removeEntry(name, {recursive: true})`).
- **Known, accepted limitation**: renaming does not rewrite manual links elsewhere that point at the old slug. This is a deliberate simple-tool tradeoff, not a bug to fix later.

## Data flow: source, in-memory, and publish

The system has three distinct tiers. Keeping them straight is central to the model:

1. **`content/` — the managed source.** The local folder the CMS user connects via FSA. Holds the site source: the markdown content tree (`content/content/…`), plus the shell, CSS, and CMS runtime. This is the _only_ thing the user directly edits, and the only thing persisted on Save.
2. **The in-memory CMS site.** On load in edit mode, the CMS reads `content/` and builds the editable SPA in memory — nav from the content tree, page content rendered from markdown. All editing happens against this in-memory model, so the user always sees their own latest edits with no re-fetch/stale-cache flash. Edits are _not_ on disk until saved.
3. **`publish/` — the generated static site.** Produced on demand when the user clicks **Publish**: a self-contained, deployable static site built from `content/`. Never hand-edited; regenerated wholesale each publish.

Actions:

- **Save** — persists the current in-memory changes for the active file back to `content/` via FSA (`createWritable()`). After a save, in-memory state and `content/` on disk agree; `publish/` does not yet reflect it.
- **Publish** — (re)generates the entire `publish/` directory from `content/`. This is what makes edits deployable. See "Publish output" below.
- **Deploy (future phase)** — a GitHub API integration inside the CMS that pushes `publish/` to GitHub Pages. Explicitly out of scope for now; the architecture just leaves room for it (publish is a clean, self-contained folder ready to be pushed).

Because Save (→ `content/`) and Publish (→ `publish/`) are separate, the edit-mode UI must make the state visible — e.g. indicate unsaved in-memory edits vs. saved-but-unpublished changes — so an editor is never misled into thinking a save is already live.

Read-only visitors are simply served a deployed copy of `publish/` by any static host; no FSA, no CMS runtime edit code involved.

## Publish output and the two display modes

`publish/` is **pre-rendered static HTML**: the Publish step walks the content tree and writes a fully-rendered `.html` file per route (markdown → HTML at build time), plus assets. Good SEO, works with JS off for reading.

Crucially, **every published page still ships `cms.js`**. This gives the deployed site two display modes from the same files:

- **View mode (default, no `?edit`)**: the visitor sees the pre-rendered static HTML as-is. `cms.js` stays dormant. Fast, no client-side markdown step.
- **Edit mode (`?edit`)**: `cms.js` activates, connects to the directory (persisted handle, or prompts), reads the **`content/`** source tree, and **rebuilds the site in memory from the source markdown** — replacing the displayed pre-rendered HTML with the freshly-built editable version. The editor therefore always works against `content/`, never against the published HTML.

**One renderer, two contexts.** The same markdown→HTML rendering (marked.js) is used both at Publish time (writing `.html` files into `publish/`) and at edit time (rendering into the live DOM). Because both paths run the identical render, the published output and the in-editor view cannot drift — this is what makes pre-rendering safe here rather than a second, divergent code path.

For the deployed site to be self-editing, the connected directory must also contain the `content/` source alongside the rendered pages. Exactly how `content/` travels with the deployed output is a Publish-phase concern; **phase 1 simply assumes the connected directory already contains the latest site plus a `content/` subdirectory.**

## Error handling

The rule: **anything that blocks an editing action gets a persistent, visible, actionable prompt — never a console-only failure or a quiet fallback.**

| Situation                                                              | Behavior                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No handle / permission denied / picker cancelled, while `?edit` is set | Persistent visible banner + reconnect button. Keeps prompting, does not fall back to read-only silently.                  |
| Permission revoked mid-session                                         | Next failing FSA operation triggers the same visible reconnect banner immediately.                                        |
| Any write failure (save/create/rename/delete)                          | Visible error naming what failed. For saves specifically, the editor stays open with the unsaved text so nothing is lost. |
| Duplicate slug on create                                               | Visible alert, abort, retry available.                                                                                    |
| Malformed frontmatter on read                                          | Silent fallback to defaults (title=slug, order=alphabetical) — not a failure needing user action.                         |
| Non-Chromium browser with `?edit` set                                  | Persistent visible message explaining editing isn't supported in this browser. Read-only browsing is unaffected.          |

## Out of scope (by design)

- Editing page layout, CSS, or the shell markup — developer-only.
- Sub-section nesting beyond one folder level.
- Automatic rewriting of links when a section/block is renamed.
- Automated test suite — mocking the File System Access API has poor ROI for a project this size. Verification is a manual smoke-test checklist instead (see plan).
- Authentication/access control on edit mode — there's no backend to gate against; anyone with local folder access can edit, by design.
- GitHub Pages deploy (pushing `publish/` via the GitHub API) — a deliberate future phase, not part of the initial engine. The `publish/` output is designed to be a clean, self-contained folder so this can be bolted on later.

## Phased build plan (high level)

Build order should validate the riskiest, most novel assumption first — that browser-based editing can write directly to markdown files on disk with no backend, smoothly, including across page reloads. Everything else (routing, nav generation, structural CRUD) is conventional web development once that loop is proven.

1. **Proof-of-concept slice**: `?edit` activation → FSA connect to the site directory (assumed to contain a `content/` subtree) → persist handle in IndexedDB → reload and verify permission re-grant → read one hardcoded source file (`content/content/index.md`) → render markdown into the live DOM (replacing the static view) → source-textarea edit → save back to `content/` on disk → confirm immediate re-render from the in-memory model with no stale refetch.
2. Hash routing across multiple pages.
3. Manifest generation + nav rendering.
4. Section/block create, rename, delete.
5. WYSIWYG (contenteditable + turndown) editor mode.
6. Error-handling banners per the table above.
7. **Publish**: generate `publish/` from `content/` (form per "Publish output" decision).
8. **Future**: GitHub API deploy of `publish/` to GitHub Pages.

Detailed steps for phase 1 belong in the implementation plan, not this design spec.
