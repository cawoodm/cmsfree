/// <reference types="vite/client" />
// cmsfree engine — build target: a single self-contained `cms.js`.
//
// Dormant unless the URL carries `?edit` (view mode only shows a re-entry pencil
// for returning editors). In edit mode it loads the site's content and i18n files into an
// in-memory model, binds the live page to it (pencils, editor, Texts panel) and
// autosaves changed files to the storage root:
//   • browser mode: OPFS, synced with the GitHub repo (↓ pull, ↑ push = one commit; remote changes are flagged)
//   • folder mode:  a local clone picked with the File System Access API
//
// This entry module wires the pieces together; each concern lives in its own
// module (state, disk, format, store, github, page, chrome).
import { MODE_PREFIX, model, state } from './state'
import type { Mode, Settings } from './state'
import { idbGetHandle, opfsSiteRoot, pickDirectory, verifyPermission } from './disk'
import { barActions, isEditMode, isReturningEditor, rememberEditor, setButtons, setStatus, showEditLauncher, showError } from './chrome'
import { ConflictError, getHead, importSetupLink, loadSettings, openSettingsDialog, publish, pull, settingsComplete, siteFolderName, siteKey, watchBuild } from './github'
import { changedFiles, flush, loadModel, readMeta, replaceContent, updateStatus, writeMeta } from './store'
import { bindPage, initLang, openTexts, rangeCounts, renderAll } from './page'

let stopWatch: (() => void) | null = null

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------
const modeKey = () => MODE_PREFIX + state.siteKey

function storedMode(): Mode | null {
  try {
    const m = localStorage.getItem(modeKey())
    return m === 'browser' || m === 'folder' ? m : null
  } catch {
    return null
  }
}

function storeMode(mode: Mode): void {
  try {
    localStorage.setItem(modeKey(), mode)
  } catch {
    /* storage blocked: ask again next time */
  }
}

// Forget the stored mode and boot again, which asks anew.
function changeMode(): void {
  try {
    localStorage.removeItem(modeKey())
  } catch {
    /* ignore */
  }
  location.reload()
}

// Chosen once per site. Without the File System Access API only browser mode exists.
async function chooseMode(): Promise<Mode> {
  const stored = storedMode()
  if (stored && (stored === 'browser' || 'showDirectoryPicker' in window)) return stored
  if (!('showDirectoryPicker' in window)) {
    storeMode('browser')
    return 'browser'
  }
  return new Promise((resolve) => {
    const pick = (m: Mode) => () => {
      storeMode(m)
      resolve(m)
    }
    setStatus('Where should your edits live?', { label: 'Edit in browser', onClick: pick('browser') }, { label: 'Use local folder', onClick: pick('folder') })
  })
}

// ---------------------------------------------------------------------------
// Browser mode
// ---------------------------------------------------------------------------
// Settings must be complete before anything else. Cancelling waits for the user to try again.
async function ensureSettings(note: string): Promise<Settings> {
  for (;;) {
    const s = loadSettings()
    if (settingsComplete(s)) return s
    const saved = await openSettingsDialog(note, changeMode)
    if (!saved) await new Promise<void>((resolve) => setStatus('GitHub settings are needed to load the site.', { label: 'Open settings', onClick: resolve }))
  }
}

// Pull and replace the local content; on failure offer Try again / Settings until it works.
async function pullInto(s: Settings): Promise<void> {
  for (;;) {
    try {
      setStatus('Pulling the site from GitHub…')
      const { files, meta } = await pull(s)
      await replaceContent(files, meta)
      return
    } catch (err) {
      await new Promise<void>((resolve) =>
        setStatus(
          'Pull failed: ' + (err as Error).message,
          { label: 'Try again', onClick: resolve },
          { label: 'Settings', onClick: () => void openSettingsDialog('', changeMode).then(() => resolve()) },
        ),
      )
      s = loadSettings()
    }
  }
}

async function openBrowser(): Promise<boolean> {
  const s = await ensureSettings('Enter the GitHub repo of this site. The token is optional for pulling a public repo.')
  state.root = await opfsSiteRoot(siteFolderName(s))
  void navigator.storage?.persist?.()
  state.base = await readMeta()
  if (!state.base) {
    await pullInto(s)
  } else {
    await loadModel()
    let head: string | null = null
    try {
      head = await getHead(s)
    } catch {
      /* offline or rate limited: keep working on the local copy */
    }
    // Nothing unpublished: take the new state silently. Otherwise flag it; ↓ merges when the user is ready.
    if (head && head !== state.base.commit) {
      if ((await changedFiles()).length === 0) await pullInto(s)
      else state.remoteChanged = true
    }
  }
  setButtons({ texts: true, publish: true, gear: true })
  return true
}

let busy = false // a pull or publish is running: the remote check waits
let lastCheck = 0

// Flags new commits on the branch (highlighted ↓ plus a status note). Errors (offline, rate limit) are ignored.
async function checkRemote(): Promise<void> {
  if (state.mode !== 'browser' || !state.base || busy || document.hidden) return
  lastCheck = Date.now()
  try {
    const moved = (await getHead(loadSettings())) !== state.base.commit
    if (moved !== state.remoteChanged && !busy) {
      state.remoteChanged = moved
      await updateStatus()
    }
  } catch {
    /* keep the last known state */
  }
}

// Every minute with a token (5000 API calls/h), every 5 minutes without (60/h), and when the tab becomes visible again.
function watchRemote(): void {
  window.setInterval(() => void checkRemote(), loadSettings().token ? 60_000 : 300_000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheck > 30_000) void checkRemote()
  })
}

// ↓ Pull: take GitHub's latest files. Unpublished edits to files GitHub did not change are kept;
// a file changed both here and on GitHub asks first (OK takes GitHub's version, Cancel stops the pull).
async function runPull(): Promise<void> {
  if (busy) return
  busy = true
  try {
    await flush()
    setStatus('Pulling the site from GitHub…')
    let remote: Awaited<ReturnType<typeof pull>>
    try {
      remote = await pull(loadSettings())
    } catch (err) {
      setStatus('Pull failed: ' + (err as Error).message, { label: 'Try again', onClick: () => void runPull() })
      return
    }
    const local = await changedFiles()
    const base = state.base?.files ?? {}
    const both = local.filter((f) => remote.meta.files[f.path] !== base[f.path]).map((f) => f.path)
    if (both.length && !confirm(`These files changed here and on GitHub:\n\n${both.join('\n')}\n\nOK takes the GitHub version (your edits to these files are lost).\nCancel stops the pull.`)) {
      await updateStatus()
      return
    }
    const files = { ...remote.files }
    for (const f of local) if (!both.includes(f.path)) files[f.path] = f.text
    await replaceContent(files, remote.meta)
    initLang()
    renderAll()
    await updateStatus()
  } finally {
    busy = false
  }
}

async function resync(): Promise<void> {
  await pullInto(loadSettings())
  initLang()
  renderAll()
  await updateStatus()
}

async function runPublish(): Promise<void> {
  let s = loadSettings()
  if (!s.token) {
    const saved = await openSettingsDialog('Publishing needs a token with contents write access.', changeMode)
    s = loadSettings()
    if (!saved || !s.token) return
  }
  await flush()
  const changed = await changedFiles()
  if (!changed.length) {
    setStatus('Nothing to publish')
    return
  }
  stopWatch?.()
  setStatus('Publishing…')
  setButtons({ publishEnabled: false })
  busy = true
  try {
    const res = await publish(s, changed, state.base!)
    await writeMeta(res.meta)
    if (res.moved) {
      // The branch had other changes: take them in so local files match the new base.
      const pulled = await pull(s)
      await replaceContent(pulled.files, pulled.meta)
      renderAll()
    }
    stopWatch = watchBuild(s, res.meta.commit, (b) => {
      if (b.state === 'building') setStatus('Published. Building…')
      else if (b.state === 'live') setStatus('Live. Reload to see it.', { label: 'Reload', onClick: () => location.reload() })
      else if (b.state === 'failed') setStatus('Build failed.', { label: 'Open run', onClick: () => window.open(b.url, '_blank') })
      else setStatus('Published. No build result yet.')
    })
  } catch (err) {
    if (err instanceof ConflictError) setStatus(err.message, { label: 'Pull', onClick: () => void runPull() })
    else setStatus('Publish failed: ' + (err as Error).message, { label: 'Try again', onClick: () => void runPublish() })
    setButtons({ publishEnabled: true })
  } finally {
    busy = false
  }
}

// ---------------------------------------------------------------------------
// Folder mode
// ---------------------------------------------------------------------------
// Gets a usable folder handle: restore the stored one (a user gesture re-grants permission) or pick one.
async function openFolder(): Promise<boolean> {
  for (;;) {
    let handle = await idbGetHandle(state.siteKey)
    if (handle && !(await verifyPermission(handle, false))) {
      const h = handle
      const granted = await new Promise<boolean>((resolve) => setStatus('Reconnect to continue editing.', { label: 'Reconnect', onClick: () => void verifyPermission(h, true).then(resolve) }))
      if (!granted) {
        setStatus('Permission denied. Editing needs folder access.', { label: 'Try again', onClick: () => location.reload() })
        return false
      }
    }
    if (!handle) {
      await new Promise<void>((resolve) =>
        setStatus('Choose the local clone of the site repo (the folder that contains hugo.toml and content/).', {
          label: 'Choose folder',
          onClick: () => void pickDirectory(state.siteKey).then((h) => ((handle = h), resolve())).catch(() => {}),
        }),
      )
    }
    state.root = handle!
    await loadModel()
    if (model.size) {
      setButtons({ texts: true, publish: false, gear: true })
      return true
    }
    await new Promise<void>((resolve) => setStatus('This folder has no site files (content/blocks/*.md, i18n/*.yaml).', { label: 'Choose another folder', onClick: () => void pickDirectory(state.siteKey).then(() => resolve()).catch(() => {}) }))
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
barActions.onPull = () => void runPull()
barActions.onPublish = () => void runPublish()
barActions.onTexts = () => openTexts()
barActions.onSettings = () => {
  if (state.mode === 'browser') {
    // Another repo, branch or site folder means another local copy: reload to load it.
    const before = siteFolderName(loadSettings())
    void openSettingsDialog('', changeMode).then(async (saved) => {
      if (!saved || siteFolderName(loadSettings()) === before) return
      await flush()
      location.reload()
    })
  } else if (confirm('Forget this folder and choose the storage mode again?')) changeMode()
}

// The site files loaded, but the page has no block markers, so there are no pencils to click.
function warnIfNoBlocks(): void {
  const { blocks, strings } = rangeCounts()
  if (blocks) return
  showError('No editable blocks on this page', [
    `cmsfree loaded the site files but found no block markers (<!--cms:NAME.md-->) on this page${strings ? `, only ${strings} string marker(s)` : ''}. So there are no edit pencils.`,
    'Old copy of the page: the browser may show a cached page from an earlier build. Reload with the cache off (Ctrl+Shift+R, or DevTools > Network > Disable cache).',
    'Build without markers: the template must render blocks with the cms-block / cms-items partials, and the site must be built without --minify (it removes the markers).',
    'If this page really has no blocks, edit its strings in Texts.',
  ])
}

async function boot(): Promise<void> {
  if (!isEditMode()) {
    // View mode: dormant, except a returning editor gets a re-entry pencil.
    if (isReturningEditor()) showEditLauncher()
    return
  }
  setStatus('cmsfree: starting…') // show the edit bar immediately
  state.siteKey = siteKey()
  // A setup link carries the GitHub settings; it always means browser mode.
  if (importSetupLink()) storeMode('browser')
  state.mode = await chooseMode()
  const ok = state.mode === 'browser' ? await openBrowser() : await openFolder()
  if (!ok) return
  if (!model.size) {
    setStatus('No site files (content/blocks/*.md, i18n/*.yaml) found in the repo.', { label: 'Re-sync', onClick: () => void resync() })
    return
  }
  rememberEditor()
  initLang()
  bindPage()
  warnIfNoBlocks()
  window.addEventListener('beforeunload', (e) => {
    if (state.savePending) {
      e.preventDefault()
      e.returnValue = '' // a save is still pending
    }
  })
  await updateStatus()
  if (state.mode === 'browser') watchRemote()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot())
} else {
  void boot()
}

if (import.meta.hot) import.meta.hot.accept()
