# cmsfree Phase 1 — FSA Edit Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the riskiest assumption in cmsfree — that a browser can read a markdown file from a local `src/` folder, render it, let the user edit it, and write it back to disk with no backend, smoothly, and survive a page reload.

**Architecture:** A single vanilla-JS module `src/cms.js` loaded on every page. When the URL contains `?edit`, it connects to a local directory via the File System Access API (FSA), persists that directory handle in IndexedDB (so it survives reloads), reads `src/content/index.md` from the connected directory, renders it into the `<main x-cms-content>` element with marked.js (replacing the static HTML), and offers a pencil-icon → textarea → Save loop that writes changes back to disk and re-renders from the in-memory text. Without `?edit`, `cms.js` stays dormant and the page shows its static HTML.

**Tech Stack:** Vanilla ES-module JavaScript, marked.js (markdown → HTML, via CDN), the File System Access API, IndexedDB. Vite as the local dev static server (`npm run dev`, serving `src/`).

## Global Constraints

- **No backend.** All reads/writes are local via FSA; no server calls for content.
- **No build step for the source site.** Dependencies load via CDN `<script>` tags; `cms.js` is plain ES-module JS served as-is.
- **Chromium-only for editing.** FSA (`showDirectoryPicker`, `createWritable`) is required; read-only viewing is unaffected by browser.
- **Markdown is the single source of truth on disk.** Phase 1 reads/writes markdown verbatim (frontmatter preserved).
- **No silent failures in edit mode.** Anything that blocks an editing action shows a persistent, visible, actionable message — never a console-only failure or a quiet fallback to read-only. (Full error-banner matrix is a later phase; Phase 1 implements the permission/connect and save-failure cases.)
- **Deliberate scoping:** Phase 1 uses vanilla JS + marked.js only. Alpine.js and alpine-ajax are NOT introduced here — they earn their place in Phase 2 (routing/nav), where content-fragment loading is the actual job. Introducing them now would add surface without exercising the FSA risk this phase exists to prove.
- **No automated tests** (per spec — FSA mocking has poor ROI). Verification is manual in a real Chromium browser; each task's final step is a concrete browser check with an expected observable result.
- **Connected directory shape:** Phase 1 assumes the user picks a directory that contains a `src/` subdirectory (i.e. the project root, `C:\projects\Marc\cmsfree`). All source reads/writes are relative to that handle at path `src/content/…`.

**Note on commits:** This project is not yet a git repository. Commit steps below are written for the recommended frequent-commit workflow but are **optional** — if you want them, run `git init` once before Task 1 (see Setup). If not using version control, skip every "Commit" step.

---

## Setup (optional, once)

- [ ] **If you want commits:** initialize git.

```bash
cd /c/projects/Marc/cmsfree
git init
printf 'node_modules/\ndist/\npublish/\n' > .gitignore
git add -A
git commit -m "chore: scaffold example site + design spec"
```

---

## File Structure

- **Create `src/cms.js`** — the entire Phase 1 engine. Organized into clearly-named function groups within one file (it stays small in Phase 1; it will be split by responsibility in later phases if it grows): IndexedDB handle store, FSA access, frontmatter split, markdown render, edit-mode UI/controller.
- **Modify `src/index.html`** — add the marked.js CDN `<script>` and the `<script type="module" src="cms.js">` tag; the `<main x-cms-content>` target already exists.
- **Modify `src/css/style.css`** — add styles for the edit-mode chrome: the connect/error banner, the pencil icon (a `.cms-edit-icon` base rule already exists), and the source-editor textarea + Save/Cancel controls.

---

### Task 1: Edit-mode bootstrap + dependency wiring

Load `cms.js` and marked.js on the page, and prove `cms.js` can detect `?edit` and show a visible indicator only in edit mode.

**Files:**
- Modify: `src/index.html`
- Create: `src/cms.js`
- Modify: `src/css/style.css`

**Interfaces:**
- Produces: global module `src/cms.js` that runs on `DOMContentLoaded`; function `isEditMode()` → `boolean` (true when `location.search` contains `edit`); function `showBanner(message, actionLabel?, onAction?)` → renders a fixed banner element `#cms-banner`; function `hideBanner()`.

- [ ] **Step 1: Add dependencies and cms.js to the shell**

In `src/index.html`, inside `<head>` (after the stylesheet link), add marked.js:

```html
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
```

Immediately before `</body>`, add the engine:

```html
<script type="module" src="cms.js"></script>
```

- [ ] **Step 2: Create `src/cms.js` with edit-mode detection and a banner**

```js
// cmsfree engine — Phase 1 (FSA edit loop). Vanilla ES module; no framework.

// ---- edit-mode detection ----
function isEditMode() {
  return new URLSearchParams(location.search).has('edit');
}

// ---- banner (persistent, visible messages; never a console-only failure) ----
function ensureBanner() {
  let el = document.getElementById('cms-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cms-banner';
    document.body.prepend(el);
  }
  return el;
}

function showBanner(message, actionLabel, onAction) {
  const el = ensureBanner();
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.className = 'cms-banner-btn';
    btn.addEventListener('click', onAction);
    el.appendChild(btn);
  }
  el.style.display = 'flex';
}

function hideBanner() {
  const el = document.getElementById('cms-banner');
  if (el) el.style.display = 'none';
}

// ---- bootstrap ----
document.addEventListener('DOMContentLoaded', () => {
  if (!isEditMode()) return; // dormant in view mode
  showBanner('cmsfree edit mode active.');
});

export { isEditMode, showBanner, hideBanner };
```

- [ ] **Step 3: Add banner + edit-chrome styles to `src/css/style.css`**

Append:

```css
/* ---- edit-mode chrome ---- */
#cms-banner {
  display: none;
  align-items: center;
  gap: 1rem;
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 0.65rem 1.25rem;
  background: var(--brown);
  color: var(--cream);
  font-size: 0.9rem;
}
.cms-banner-btn {
  border: 1px solid var(--cream);
  background: transparent;
  color: var(--cream);
  padding: 0.3rem 0.9rem;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
}
.cms-banner-btn:hover { background: var(--cream); color: var(--brown); }

.cms-editor {
  width: 100%;
  min-height: 320px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 0.9rem;
  line-height: 1.5;
  padding: 1rem;
  border: 1px solid rgba(74,46,32,0.25);
  border-radius: 8px;
  box-sizing: border-box;
}
.cms-editor-actions { margin-top: 0.75rem; display: flex; gap: 0.75rem; }
.cms-btn {
  padding: 0.5rem 1.25rem;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.cms-btn-save { background: var(--terracotta); color: #fff; }
.cms-btn-save:hover { background: var(--terracotta-deep); }
.cms-btn-cancel { background: rgba(74,46,32,0.1); color: var(--brown); }
```

- [ ] **Step 4: Run the dev server**

```bash
cd /c/projects/Marc/cmsfree
npm run dev
```
Expected: Vite prints `Local: http://localhost:5173/`.

- [ ] **Step 5: Verify in a Chromium browser (manual)**

1. Open `http://localhost:5173/` → page shows the styled bakery homepage, **no** dark banner.
2. Open `http://localhost:5173/?edit` → a dark sticky banner reads **"cmsfree edit mode active."** at the top; the rest of the page is unchanged.

Expected: banner present only with `?edit`. If not, check the browser console for module-load errors (path must be `cms.js` relative to `src/`).

- [ ] **Step 6: Commit (optional)**

```bash
git add src/index.html src/cms.js src/css/style.css
git commit -m "feat(cms): edit-mode bootstrap + banner"
```

---

### Task 2: Connect to a directory and persist the handle across reloads

This is the core FSA-risk task: pick a directory, store its handle in IndexedDB, and re-grant permission after a reload via a user gesture.

**Files:**
- Modify: `src/cms.js`

**Interfaces:**
- Consumes: `isEditMode`, `showBanner`, `hideBanner` (Task 1).
- Produces:
  - `idbGetHandle()` → `Promise<FileSystemDirectoryHandle | undefined>`
  - `idbSetHandle(handle)` → `Promise<void>`
  - `verifyPermission(handle, {request})` → `Promise<boolean>` (checks/optionally requests `readwrite`)
  - `connectDirectory()` → `Promise<FileSystemDirectoryHandle>` (opens the picker, stores the handle)
  - a module-level `let dirHandle` holding the active handle once connected
  - `ensureConnected()` → `Promise<boolean>`: the orchestration that either restores + re-grants a stored handle, or shows a persistent Connect banner. Resolves `true` when `dirHandle` is usable.

- [ ] **Step 1: Add IndexedDB handle-store helpers to `src/cms.js`**

Add near the top (after the banner helpers):

```js
// ---- IndexedDB: persist the directory handle across reloads ----
const IDB_NAME = 'cmsfree';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'srcDir';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSetHandle(handle) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 2: Add FSA connect + permission helpers**

```js
// ---- File System Access ----
let dirHandle = null;

async function verifyPermission(handle, { request } = { request: false }) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (request && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function connectDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSetHandle(handle);
  dirHandle = handle;
  return handle;
}
```

- [ ] **Step 3: Add the `ensureConnected` orchestration (no silent fallback)**

```js
// Ensures dirHandle is usable. Restores a stored handle (re-granting permission
// via a user gesture), or shows a persistent Connect banner. Never silently
// falls back to read-only while ?edit is set.
async function ensureConnected() {
  if (dirHandle && (await verifyPermission(dirHandle, { request: false }))) {
    return true;
  }
  const stored = await idbGetHandle();
  if (stored) {
    // Permission cannot be re-granted silently after reload — needs a gesture.
    if (await verifyPermission(stored, { request: false })) {
      dirHandle = stored;
      return true;
    }
    return new Promise((resolve) => {
      showBanner('Reconnect to continue editing.', 'Reconnect', async () => {
        if (await verifyPermission(stored, { request: true })) {
          dirHandle = stored;
          hideBanner();
          resolve(true);
        } else {
          showBanner('Permission denied. Editing needs folder access.', 'Reconnect', () => location.reload());
          resolve(false);
        }
      });
    });
  }
  return new Promise((resolve) => {
    showBanner('Connect your site folder to start editing.', 'Connect folder', async () => {
      try {
        await connectDirectory();
        hideBanner();
        resolve(true);
      } catch (err) {
        showBanner('Folder not connected. Editing needs folder access.', 'Connect folder', () => location.reload());
        resolve(false);
      }
    });
  });
}
```

- [ ] **Step 4: Call `ensureConnected` from bootstrap**

Replace the `DOMContentLoaded` handler body from Task 1:

```js
document.addEventListener('DOMContentLoaded', async () => {
  if (!isEditMode()) return;
  const ok = await ensureConnected();
  if (ok) showBanner('Connected. cmsfree edit mode active.');
});
```

Also extend the `export {…}` line to include the new functions:

```js
export { isEditMode, showBanner, hideBanner, ensureConnected, connectDirectory, idbGetHandle };
```

- [ ] **Step 5: Verify connect + persistence (manual, Chromium)**

1. Open `http://localhost:5173/?edit` → banner shows **"Connect your site folder…"** with a **Connect folder** button.
2. Click it → OS picker opens → choose the project root `C:\projects\Marc\cmsfree` → grant read/write → banner changes to **"Connected. cmsfree edit mode active."**
3. Open DevTools → Application → IndexedDB → `cmsfree` → `handles` → confirm a `srcDir` entry exists.
4. **Reload** `http://localhost:5173/?edit` → banner shows **"Reconnect to continue editing."** with a **Reconnect** button (this is the expected, spec-mandated gesture — browsers cannot silently restore write permission). Click **Reconnect** → grant → **"Connected…"**.
5. Open `http://localhost:5173/` (no `?edit`) → no banner, no picker.

Expected: handle persists in IndexedDB; reload requires exactly one Reconnect click; cancelling the picker leaves a persistent "not connected" banner (verify by clicking Connect then pressing Esc in the picker).

- [ ] **Step 6: Commit (optional)**

```bash
git add src/cms.js
git commit -m "feat(cms): connect directory + persist handle in IndexedDB"
```

---

### Task 3: Read and render `src/content/index.md` into the content area

Once connected, read the homepage source from the connected directory, strip frontmatter, render markdown, and replace the static content.

**Files:**
- Modify: `src/cms.js`

**Interfaces:**
- Consumes: `dirHandle` (Task 2), the global `marked` (from CDN, `marked.parse`).
- Produces:
  - `readSourceFile(relPath)` → `Promise<string>` (reads a UTF-8 text file at a path relative to `dirHandle`, e.g. `"src/content/index.md"`)
  - `splitFrontmatter(text)` → `{ frontmatter: string, body: string }` (frontmatter is the raw block *including* the `---` fences, or `""` if none; body is the remainder)
  - `renderInto(targetSelector, markdownBody)` → sets `innerHTML` of the target to `marked.parse(markdownBody)`
  - module-level constant `HOME_PATH = 'src/content/index.md'`
  - module-level `let currentText` holding the full raw file text (frontmatter + body) of the loaded file

- [ ] **Step 1: Add file-read, frontmatter-split, and render helpers**

```js
const HOME_PATH = 'src/content/index.md';
let currentText = '';

// Walk a "/"-separated path from dirHandle and read the file as text.
async function readSourceFile(relPath) {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  let dir = dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return await file.text();
}

// Split leading YAML-lite frontmatter (--- ... ---) from the markdown body.
function splitFrontmatter(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: '', body: text };
  return { frontmatter: match[0], body: text.slice(match[0].length) };
}

function renderInto(targetSelector, markdownBody) {
  const target = document.querySelector(targetSelector);
  if (target) target.innerHTML = marked.parse(markdownBody);
}
```

- [ ] **Step 2: Load and render the homepage after connecting**

Update the bootstrap handler to load content once connected:

```js
document.addEventListener('DOMContentLoaded', async () => {
  if (!isEditMode()) return;
  const ok = await ensureConnected();
  if (!ok) return;
  showBanner('Connected. cmsfree edit mode active.');
  await loadHome();
});

async function loadHome() {
  currentText = await readSourceFile(HOME_PATH);
  const { body } = splitFrontmatter(currentText);
  renderInto('[x-cms-content]', body);
}
```

Extend exports:

```js
export { isEditMode, showBanner, hideBanner, ensureConnected, connectDirectory,
         idbGetHandle, readSourceFile, splitFrontmatter, renderInto, loadHome };
```

- [ ] **Step 3: Verify render (manual, Chromium)**

1. Open `http://localhost:5173/?edit`, connect (or reconnect) to the project root.
2. The `<main>` content area should now show the rendered **`src/content/index.md`** — a heading "Welcome to Hearth & Wheat Bakery", the intro paragraph, the "Open Tuesday–Sunday…" line, and a "See what we offer →" link. The original static teaser grid is **replaced** by the rendered markdown (expected — edit mode always rebuilds from source).
3. Sanity-check the frontmatter split: the rendered output must **not** contain the literal `--- title: Home ---` text.

Expected: rendered markdown replaces the static content; no frontmatter leaks into the page.

- [ ] **Step 4: Commit (optional)**

```bash
git add src/cms.js
git commit -m "feat(cms): read + render src/content/index.md in edit mode"
```

---

### Task 4: Pencil icon → source editor → Save to disk → re-render

The write half of the loop: edit the raw markdown in a textarea and persist it via FSA, then re-render from the in-memory text without re-fetching.

**Files:**
- Modify: `src/cms.js`

**Interfaces:**
- Consumes: `dirHandle`, `currentText`, `HOME_PATH`, `splitFrontmatter`, `renderInto`, `showBanner` (earlier tasks).
- Produces:
  - `writeSourceFile(relPath, text)` → `Promise<void>` (writes UTF-8 text via `createWritable()`)
  - `addEditAffordance()` → injects a pencil icon into the content area
  - `openEditor()` / `closeEditor(save)` → swap the content area between rendered view and a `<textarea class="cms-editor">` holding `currentText`; on save, write to disk, update `currentText`, and re-render.

- [ ] **Step 1: Add the file-write helper**

```js
async function writeSourceFile(relPath, text) {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  let dir = dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}
```

- [ ] **Step 2: Add the pencil affordance and editor open/close**

```js
function addEditAffordance() {
  const target = document.querySelector('[x-cms-content]');
  if (!target || target.querySelector('.cms-edit-icon')) return;
  const pencil = document.createElement('span');
  pencil.className = 'cms-edit-icon';
  pencil.title = 'Edit this page';
  pencil.textContent = '✎'; // ✎
  pencil.addEventListener('click', openEditor);
  target.prepend(pencil);
}

function openEditor() {
  const target = document.querySelector('[x-cms-content]');
  target.innerHTML = '';

  const textarea = document.createElement('textarea');
  textarea.className = 'cms-editor';
  textarea.value = currentText;

  const actions = document.createElement('div');
  actions.className = 'cms-editor-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'cms-btn cms-btn-save';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cms-btn cms-btn-cancel';
  cancelBtn.textContent = 'Cancel';

  saveBtn.addEventListener('click', () => closeEditor(true, textarea.value));
  cancelBtn.addEventListener('click', () => closeEditor(false));

  actions.append(saveBtn, cancelBtn);
  target.append(textarea, actions);
  textarea.focus();
}

async function closeEditor(save, newText) {
  if (save) {
    try {
      await writeSourceFile(HOME_PATH, newText);
      currentText = newText;
    } catch (err) {
      // No silent failure: keep the editor open with the unsaved text.
      showBanner('Save failed: ' + err.message + ' Your text is still here.');
      return;
    }
  }
  const { body } = splitFrontmatter(currentText);
  renderInto('[x-cms-content]', body);
  addEditAffordance();
}
```

- [ ] **Step 3: Show the pencil after the homepage loads**

In `loadHome()`, after `renderInto(...)`, add the affordance:

```js
async function loadHome() {
  currentText = await readSourceFile(HOME_PATH);
  const { body } = splitFrontmatter(currentText);
  renderInto('[x-cms-content]', body);
  addEditAffordance();
}
```

Extend exports to include `writeSourceFile`, `openEditor`, `closeEditor`, `addEditAffordance`.

- [ ] **Step 4: Verify the full edit loop (manual, Chromium)**

1. Open `http://localhost:5173/?edit`, connect/reconnect.
2. A pencil icon (✎) appears at the top of the content area. Click it → the content is replaced by a textarea showing the **raw** file text, including the `--- title: Home ---` frontmatter.
3. Change a visible word (e.g. "Welcome" → "Welcome back"), click **Save**.
4. The textarea is replaced by the re-rendered markdown showing your change immediately (no page reload). The pencil reappears.
5. Confirm it hit disk: in a terminal, `cat src/content/index.md` (or reopen the file) → the change is present, and the frontmatter block is intact at the top.
6. Click pencil → change again → **Cancel** → content re-renders from the last saved text; the discarded change is gone.

Expected: edits persist to `src/content/index.md` on disk, re-render is immediate from in-memory text, frontmatter is preserved, Cancel discards.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/cms.js
git commit -m "feat(cms): source-textarea editor with save-to-disk and re-render"
```

---

### Task 5: Save-failure and permission-loss visibility

Round out the "no silent failure" guarantee for the write path and mid-session permission loss.

**Files:**
- Modify: `src/cms.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `writeSourceFile` guarded by a fresh permission check; save errors already surface via the Task 4 banner path — this task verifies and hardens them.

- [ ] **Step 1: Re-verify permission before writing**

Update `writeSourceFile` to re-check permission first, so a mid-session revocation surfaces as a visible reconnect prompt rather than a thrown-away write:

```js
async function writeSourceFile(relPath, text) {
  if (!(await verifyPermission(dirHandle, { request: true }))) {
    throw new Error('folder access was lost — click Reconnect');
  }
  const parts = relPath.split('/');
  const fileName = parts.pop();
  let dir = dirHandle;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}
```

- [ ] **Step 2: Verify failure visibility (manual, Chromium)**

1. With the editor open and text changed, in DevTools → Application → IndexedDB you cannot easily revoke FSA permission, so simulate a write failure instead: temporarily rename `src/content` to `src/content_x` on disk, then click **Save**.
2. Expected: a visible banner reads **"Save failed: …"** and the editor **stays open with your text intact** (nothing lost). Rename the folder back, click Save again → succeeds.

- [ ] **Step 3: Commit (optional)**

```bash
git add src/cms.js
git commit -m "feat(cms): re-verify permission before write; surface save failures"
```

---

## Phase 1 Definition of Done

All of the following, verified manually in a Chromium browser:

- [ ] `?edit` shows edit chrome; plain URL shows the static site untouched.
- [ ] Connecting a folder persists the handle; reload requires exactly one Reconnect gesture, then works.
- [ ] `src/content/index.md` renders into the content area with frontmatter stripped.
- [ ] Editing in the textarea and saving writes to `src/content/index.md` on disk and re-renders immediately from in-memory text.
- [ ] Cancel discards; a save failure keeps the editor open with the text and shows a visible message.
- [ ] No console-only failures in any of the above blocking paths.

## Self-Review Notes (author)

- **Spec coverage:** This plan implements exactly the spec's "Phase 1 — Proof-of-concept slice" bullet and the Phase-1-relevant rows of the error-handling matrix (permission denied / picker cancelled / permission revoked / save failure). Routing, manifest/nav, structural CRUD, WYSIWYG, and Publish are explicitly out of this plan (their own phases).
- **Deferred deps:** Alpine/alpine-ajax intentionally deferred to Phase 2 — recorded in Global Constraints so it's a conscious decision, not a gap.
- **Type consistency:** `dirHandle`, `currentText`, `HOME_PATH`, `readSourceFile`/`writeSourceFile`, `splitFrontmatter` (returns `{frontmatter, body}`), `renderInto`, and the `[x-cms-content]` selector are used consistently across Tasks 2–5.
