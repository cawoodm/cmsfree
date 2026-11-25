/// <reference types="vite/client" />
// cmsfree engine — build target: a single self-contained `cms.js`.
//
// Dormant unless the URL carries `?edit` (view mode only shows a re-entry pencil
// for returning editors). In edit mode it loads the site's content and i18n files into an
// in-memory model, binds the live page to it (pencils, editor, Texts panel) and
// autosaves changed files to the browser (OPFS), synced with the GitHub repo
// (↓ pull, ↑ push = one commit; remote changes are flagged). ⚙ can download the files as a .zip.
//
// This entry module wires the pieces together; each concern lives in its own
// module (state, disk, format, store, github, page, chrome).
import { model, state } from './state'
import type { Settings } from './state'
import { opfsSiteRoot } from './disk'
import { barActions, isEditMode, isReturningEditor, rememberEditor, setButtons, setStatus, showEditLauncher, showError } from './chrome'
import { ConflictError, checkSettings, getHead, importSetupLink, loadSettings, openSettingsDialog, publish, pull, settingsComplete, siteFolderName, siteKey, toRepoPath, watchBuild } from './github'
import { download, zip } from './zip'
import { changedFiles, flush, loadModel, readMeta, replaceContent, updateStatus, writeMeta } from './store'
import { bindPage, initLang, openTexts, rangeCounts, renderAll } from './page'

let stopWatch: (() => void) | null = null

// ---------------------------------------------------------------------------
// Open the site
// ---------------------------------------------------------------------------
// Settings must be complete before anything else. Cancelling waits for the user to try again.
async function ensureSettings(note: string): Promise<Settings> {
  for (;;) {
    const s = loadSettings()
    if (settingsComplete(s)) return s
    const saved = await openSettingsDialog(note)
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
        setStatus('Pull failed: ' + (err as Error).message, { label: 'Try again', onClick: resolve }, { label: 'Settings', onClick: () => void openSettingsDialog('', true).then(() => resolve()) }),
      )
      s = loadSettings()
    }
  }
}

// `fromLink`: the settings just came from a setup link. They are checked on GitHub first; problems open the settings dialog.
async function openSite(fromLink: boolean): Promise<void> {
  let s = await ensureSettings('Enter the GitHub repo of this site. The token is optional for pulling a public repo.')
  if (fromLink) {
    setStatus('Checking the setup link on GitHub…')
    if ((await checkSettings(s)).length) {
      await openSettingsDialog('The setup link has problems (marked below). Fix them, or Save anyway.', true)
      s = loadSettings()
    }
  }
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
}

let busy = false // a pull or publish is running: the remote check waits
let lastCheck = 0

// Flags new commits on the branch (highlighted ↓ plus a status note). Errors (offline, rate limit) are ignored.
async function checkRemote(): Promise<void> {
  if (!state.base || busy || document.hidden) return
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
    const saved = await openSettingsDialog('Publishing needs a token with contents write access.')
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
// Boot
// ---------------------------------------------------------------------------
barActions.onPull = () => void runPull()
barActions.onPublish = () => void runPublish()
barActions.onTexts = () => openTexts()
barActions.onSettings = () => {
  // Another repo, branch or site folder means another local copy: reload to load it.
  const before = siteFolderName(loadSettings())
  void openSettingsDialog('', false, () => void downloadZip()).then(async (saved) => {
    if (!saved || siteFolderName(loadSettings()) === before) return
    await flush()
    location.reload()
  })
}

// Download .zip: the site files as they are in this browser (unpublished edits included) at their repo paths,
// so the archive unpacks over the root of a clone. .cmsfree/meta.json stays out.
async function downloadZip(): Promise<void> {
  await flush()
  const s = loadSettings()
  const files: Record<string, string> = {}
  for (const [path, text] of model) files[toRepoPath(s, path)] = text
  download(await zip(files), `${s.repo}-${s.branch}-${new Date().toISOString().slice(0, 10)}.zip`)
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
  // A setup link carries the GitHub settings.
  const link = importSetupLink()
  if (link === 'invalid')
    showError('Setup link not valid', ['The link is damaged or incomplete (owner and repository are needed), so its settings were not used.', 'Ask for a new link, or enter the settings with ⚙.'])
  await openSite(link === 'imported')
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
  watchRemote()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot())
} else {
  void boot()
}

if (import.meta.hot) import.meta.hot.accept()
