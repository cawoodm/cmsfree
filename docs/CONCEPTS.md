# Content model concepts

cmsfree's whole content model is just files and folders under `content/`. This
doc defines the five building blocks — **folder**, **page**, **section**,
**block**, and **fragment** — and how they relate.

```
content/
  template.html          ← layout shell, not content (see README)
  index.md                page: home
  about-us/                folder + section
    index.md               page: /about-us/
  services/                folder + section
    index.md               page: /services/
    custom-cakes.md         page: /services/custom-cakes (a block)
    _pricing.md             NOT a page — a fragment, [include]d by a page
  _hidden/                 folder + hidden section
    index.md                page: /hidden/ (published, not in nav)
```

## Folder

Any directory directly under `content/` (one level deep — cmsfree doesn't
nest folders further). A folder groups a **section**'s pages together; the
folder name becomes that section's URL slug.

Two folder names are reserved and never treated as content:

- **`_assets`** — static files (`css/`, `images/`, favicon, `cms.js`) copied
  verbatim into `publish/` by Publish. Never parsed as markdown.
- Dot-folders (`.git`, `.DS_Store`, …) — OS/tooling noise, ignored.

(See `isManagedSectionDir()` in `src/model.ts`.)

## Page

Any `.md` file that gets rendered to its own URL when published. A page is
the unit `modelRoutes()` (`src/model.ts`) turns into one static HTML file.
There are three kinds:

- The **home page** — `content/index.md` → `/`.
- A **section page** — a folder's `index.md` → `/<folder>/`.
- A **block** — any other named `.md` file in a section folder (see below).

A `.md` file whose name starts with `_` is the one exception: it's a
**fragment**, not a page (see below) — it never gets a route of its own.

Pages can set frontmatter:

- `title:` — used in the nav and `<title>`; falls back to a titleized slug.
- `slug:` — the identity used in `data-cms-show="page.slug !== '...'"`
  template expressions; falls back to one derived from the route
  (`defaultSlug()` in `src/routes.ts`).
- `order:` — sort position among sibling sections/blocks; falls back to last.

## Section

A folder under `content/` that has an `index.md`. Its `index.md` is that
section's page, and it's the natural home for the section's blocks and
fragments (they live as sibling files in the same folder).

By default, every section appears in the generated navigation
(`scanSections()` in `src/model.ts`), ordered by `order:` then title.

**Hidden sections**: a folder named with a leading underscore (e.g.
`content/_hidden`) is still a real section — loaded, saved, and published
like any other — it's just left out of the nav. Its public URL drops the
underscore (`content/_hidden/` publishes to `/hidden/`), so the hidden-ness
is purely an authoring convention, invisible to visitors. Use this for pages
you want reachable by direct link but not advertised (an unlisted style
guide, a legal page, a work-in-progress). Created by naming the folder
yourself — there's no toolbar button for it (the underscore-to-URL mapping
lives in `publicSlug()`/`defaultSlug()`, `src/routes.ts`).

## Block

An **unlisted page**: any `.md` file in a section folder other than
`index.md` and not underscore-prefixed (e.g. `content/services/custom-cakes.md`).
A block gets its own route and its own published HTML file, exactly like a
section page — the only difference is it's never listed in the nav, so
visitors only reach it via a link you place in your content (e.g.
`[Custom cakes](#/services/custom-cakes)`).

Created with the editor toolbar's **"+ page"** button (`createBlock()` in
`src/crud.ts` — internally still called a "block"; the button label was
changed to "+ page" to avoid confusion with fragments, added later). Rename
and delete it with the **"✎ name"** / **"🗑 block"** buttons shown when
you're viewing one (`currentIsBlock()` in `src/model.ts` detects this).

## Fragment

A piece of content **concatenated into another page**, with **no page or URL
of its own**. A fragment is a sibling `.md` file in a section folder whose
name starts with `_` (e.g. `content/services/_pricing.md`) — `modelRoutes()`
skips underscore-prefixed filenames, so it's loaded and saved like any other
content but never becomes a route or a published HTML file on its own.

A fragment is pulled into a page via an `[include](_pricing.md)` line
(`renderBody()` / `matchSectionFiles()` in `src/content.ts`) — that exact
directive, alone on its own line, gets replaced at render time with the
fragment's rendered HTML, wrapped in `<article class="cms-include">`. The
same mechanism supports a glob (`[include](blog-*.md)`, used by the blog
listing) to concatenate *several* matching files at once, in `order:`/title
order — a hand-written fragment `[include]` just happens to name one file
exactly.

Created with the editor toolbar's **"+ fragment"** button
(`createFragment()` in `src/crud.ts`), which creates the `_<slug>.md` file
and appends the `[include]` line to whichever page you're currently viewing.

## Quick comparison

| Concept  | Is a folder? | Is a page (has a route)? | In the nav? | Created via |
|----------|:---:|:---:|:---:|---|
| Folder   | yes | — | — | naming a directory under `content/` |
| Section  | yes | yes (its `index.md`) | yes, unless `_`-prefixed | "＋" in the nav ("New section") |
| Block    | no  | yes | no | "＋ page" toolbar button |
| Fragment | no  | **no** | no | "＋ fragment" toolbar button |
