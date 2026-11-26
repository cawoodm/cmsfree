# Content model concepts

cmsfree's whole content model is just files and folders under `content/`. This
doc defines the building blocks — **folder**, **section**, **page**, **block**,
and **post** (plus **hidden** files) — and how they relate.

```
content/
  template.html            ← layout shell, not content (see README)
  index.md                 → home page  (a Section index at the root)
  about-us/                folder + Section
    index.md               → Section page: /about-us/
  services/                folder + Section
    index.md               → Section page: /services/
    custom-cakes.md        → Page: /services/custom-cakes  (published, not in nav)
    _pricing.md            → Block — included by a page, never published alone
  blog/                    folder + Section
    index.md               → Section page: /blog/  (lists its posts via [include])
    index.blog-1.md        → Post — a list item, never published alone
    index.blog-2.md        → Post
  _hidden/                 folder + hidden Section
    index.md               → /hidden/  (published, just left out of the nav)
  .draft.md                → Hidden file — never published (reserved)
```

The one rule that decides everything: **a file's kind is read from its
filename** (see `classifyFile()` in `src/model.ts`). Beware that a leading
underscore means *different* things on a folder vs a file (see Block below).

## Folder

Any directory directly under `content/` (one level deep — cmsfree doesn't nest
folders further). A folder groups a **section**'s files together; the folder
name becomes that section's URL slug.

Two folder names are reserved and never treated as content:

- **`_assets`** — static files (`css/`, `images/`, favicon, `cms.js`) copied
  verbatim into `publish/` by Publish. Never parsed as markdown.
- Dot-folders (`.git`, `.DS_Store`, …) — OS/tooling noise, ignored.

(See `isManagedSectionDir()` in `src/model.ts`.)

## Section

A folder under `content/` that has an `index.md`. That `index.md` is the
section's published page, and the folder is the natural home for the section's
pages, blocks, and posts (all siblings in the same folder). By default every
section appears in the generated nav (`scanSections()`, ordered by `order:`
then title). The root `content/index.md` is the site's home page.

**Hidden sections**: a folder named with a leading underscore (e.g.
`content/_hidden`) is still a real section — loaded, saved, and **published**
like any other — it's just left out of the nav. Its public URL drops the
underscore (`content/_hidden/` → `/hidden/`), so the hidden-ness is purely an
authoring convention, invisible to visitors. Use it for pages reachable by
direct link but not advertised (an unlisted style guide, a legal page, a WIP).
There's no toolbar button — you create it by naming the folder yourself (the
underscore-to-URL mapping lives in `publicSlug()`/`defaultSlug()`,
`src/routes.ts`).

## Page

A named `.md` file with **no leading underscore and no dot in its name** (e.g.
`content/services/custom-cakes.md`). A page is **published** to its own URL,
exactly like a section page — the only difference is it's **not in the nav**, so
visitors reach it only via a link you place in your content (e.g.
`[Custom cakes](#/services/custom-cakes)`).

Page frontmatter:

- `title:` — used in the nav (for sections) and `<title>`; falls back to a
  titleized slug.
- `slug:` — the identity used in `data-cms-show="page.slug !== '...'"` template
  expressions; falls back to one derived from the route (`defaultSlug()` in
  `src/routes.ts`).
- `order:` — sort position among siblings; falls back to last.

Created with the editor toolbar's **"＋ page"** button (`createPage()` in
`src/crud.ts`). Rename/delete it with **"✎ name"** / **"🗑 page"**, shown when
you're viewing one (`currentIsPage()` in `src/model.ts`).

## Block

A piece of content **included into another page**, with **no page or URL of its
own**. A block is a sibling `.md` file whose name **starts with `_`** (e.g.
`content/services/_pricing.md`) — `classifyFile()` marks it a block, so
`modelRoutes()` never gives it a route or a published HTML file.

> **Underscore, folder vs file:** on a **folder** a leading `_` means a *hidden
> section* (still published, just not in nav); on a **file** it means a *block*
> (never published). Don't conflate the two.

A block is pulled into a page with an `[include](_pricing.md)` line
(`renderBody()` / `matchSectionFiles()` in `src/content.ts`) — that directive,
alone on its own line, is replaced at render time with the block's rendered
HTML, wrapped in `<article class="cms-include">`. The same directive accepts a
glob (`[include](_promo-*.md)`) to concatenate several matching files at once,
in `order:`/title order.

Created with the editor toolbar's **"＋ block"** button (`createBlock()` in
`src/crud.ts`), which creates the `_<slug>.md` file and appends the `[include]`
line to the page you're currently viewing.

## Post

A **list item** — a `.md` file with a **dot inside its name** (not at the
start), e.g. `content/blog/index.blog-1.md`. Like a block, a post is **never
published on its own**; it exists only to be surfaced inside a list on another
page (typically its section index — e.g. `blog/index.md` pulls in its posts).
The naming convention `index.<name>.md` associates the post with the page that
lists it.

Today posts are surfaced with the same glob `[include]` mechanism as blocks
(e.g. `blog/index.md` contains `[include](index.blog-*.md)`); richer
post-listing behaviour is reserved for later.

## Hidden

Any `.md` file whose name **starts with `.`** (e.g. `content/.draft.md`). Hidden
files are **never published** and don't appear anywhere — they're loaded and
preserved on Save but otherwise inert, reserved for later functionality.

## Quick comparison

| Concept | Filename shape      | Published? | Own URL? | In nav? | Created via                          |
| ------- | ------------------- | :--------: | :------: | :-----: | ------------------------------------ |
| Section | `folder/index.md`   |    yes     |   yes    | yes¹    | "＋" in the nav ("New section")       |
| Page    | `name.md`           |    yes     |   yes    |   no    | "＋ page" toolbar button              |
| Block   | `_name.md`          |     no     |    no    |   no    | "＋ block" toolbar button             |
| Post    | `name.part.md`      |     no     |    no    |   no    | naming a file `index.<name>.md`       |
| Hidden  | `.name.md`          |     no     |    no    |   no    | naming a file with a leading dot      |

¹ unless the section folder is `_`-prefixed (a hidden section) — still published,
just out of the nav.
