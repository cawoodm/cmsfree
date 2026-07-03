// cmsfree engine — build target: a single self-contained `cms.js`.
//
// Content-agnostic: this bundle knows nothing about any specific site's
// content/ or publish/. It activates only when the URL carries `?edit`, then
// connects (via the File System Access API) to the SITE ROOT — the directory
// that contains both `content/` (the editable markdown source) and `publish/`
// (the generated static site).
//
// Editing model: on connect, the entire content/ tree is read into an
// in-memory model. ALL edits — page text and structural create/rename/delete —
// mutate the in-memory model only. Nothing is written to disk, and no version
// is bumped, until the user clicks the global Save button, which flushes the
// whole model to disk in one pass and bumps content/version.json once.
//
// This entry module wires the pieces together; each concern lives in its own
// module (state, disk, model, assets, content, chrome, save, publish, github,
// view, editor, crud, router). Vite bundles them into one `cms.js`.
import { state, EDITOR_FLAG } from './state'
import {
  idbGetHandle,
  connectDirectory,
  verifyPermission,
  dirExists,
} from './disk'
import { loadModel } from './model'
import { loadAssetUrls } from './assets'
import {
  isEditMode,
  showEditLauncher,
  setStatus,
  updateSaveButton,
  barActions,
} from './chrome'
import { saveAll } from './save'
import { publishSite } from './publish'
import { deployToGitHub, openSettingsDialog, loadGhSettings } from './github'
import {
  pullFromGitHub,
  localContentVersion,
  remoteContentVersion,
} from './sync'
import { applyTemplateShell, renderNav } from './view'
import { renderRoute, onNavClick } from './router'

// Register the top-bar button handlers (keeps chrome free of upward imports).
barActions.onSave = () => void saveAll()
barActions.onPublish = () => void publishSite()
barActions.onDeploy = () => void deployToGitHub()
barActions.onSettings = () => openSettingsDialog()

// Ensures state.dirHandle is usable. Restores a stored handle (re-granting
// permission via a user gesture), or shows a persistent Connect prompt. Never
// silently falls back to read-only while ?edit is set.
async function ensureConnected(): Promise<boolean> {
  if (state.dirHandle && (await verifyPermission(state.dirHandle, false)))
    return true

  const stored = await idbGetHandle()
  if (stored) {
    if (await verifyPermission(stored, false)) {
      state.dirHandle = stored
      return true
    }
    // Permission can't be re-granted silently after reload — needs a gesture.
    return new Promise((resolve) => {
      setStatus('Reconnect to continue editing.', 'Reconnect', async () => {
        if (await verifyPermission(stored, true)) {
          state.dirHandle = stored
          resolve(true)
        } else {
          setStatus(
            'Permission denied. Editing needs folder access.',
            'Try again',
            () => location.reload(),
          )
          resolve(false)
        }
      })
    })
  }

  return new Promise((resolve) => {
    setStatus(
      'Connect your site folder to start editing.',
      'Connect folder',
      async () => {
        try {
          await connectDirectory()
          resolve(true)
        } catch {
          setStatus(
            'Folder not connected. Editing needs folder access.',
            'Connect folder',
            () => location.reload(),
          )
          resolve(false)
        }
      },
    )
  })
}

// Ensure the connected folder holds a content/ tree to edit. Two cases:
//  • Empty folder (new machine, no clone): block on a Pull prompt until the
//    site is pulled from GitHub. If owner/repo aren't set yet, the prompt opens
//    Settings first. Never resolves until content/ exists — you can't edit an
//    empty folder.
//  • Existing copy: best-effort compare local vs repo content version and, if
//    the repo is strictly newer, offer a blocking Re-sync before we load the
//    model (so the in-memory model reflects the freshly pulled files). Runs
//    before loadModel(). Local-ahead / equal / offline → proceed silently.
async function ensureSynced(): Promise<void> {
  if (await dirExists(['content'])) {
    await maybeOfferResync()
    return
  }
  await pullEmptyFolder()
}

function pullEmptyFolder(): Promise<void> {
  return new Promise((resolve) => {
    const attempt = async (): Promise<void> => {
      const s = loadGhSettings()
      if (!s.owner || !s.repo) {
        openSettingsDialog(
          'This folder is empty. Enter owner + repo (token optional for a public repo) to pull the site.',
        )
        setStatus(
          'Empty folder — set owner + repo in Settings, then pull.',
          'Pull from GitHub',
          () => void attempt(),
        )
        return
      }
      try {
        await pullFromGitHub(s)
        resolve()
      } catch (err) {
        setStatus('Pull failed: ' + (err as Error).message, 'Try again', () =>
          void attempt(),
        )
      }
    }
    const ready = (() => {
      const s = loadGhSettings()
      return !!(s.owner && s.repo)
    })()
    setStatus(
      'This folder is empty. Pull the site from GitHub to start editing.',
      ready ? 'Pull from GitHub' : 'Set up GitHub',
      () => void attempt(),
    )
  })
}

async function maybeOfferResync(): Promise<void> {
  const s = loadGhSettings()
  if (!s.owner || !s.repo) return
  const local = await localContentVersion()
  const remote = await remoteContentVersion(s)
  if (remote == null || remote <= local) return // equal, local ahead, or unknown
  const yes = confirm(
    `A newer version of this site (v${remote}) is on GitHub — your local copy is v${local}.\n\n` +
      'Re-sync now? This downloads the repo and overwrites matching local files ' +
      '(local-only files are kept).',
  )
  if (!yes) return
  try {
    await pullFromGitHub(s)
  } catch (err) {
    setStatus('Re-sync failed: ' + (err as Error).message)
  }
}

async function boot(): Promise<void> {
  if (!isEditMode()) {
    // View mode: dormant, except a returning editor gets a re-entry pencil.
    if (localStorage.getItem(EDITOR_FLAG) === '1') showEditLauncher()
    return
  }
  setStatus('cmsfree — connecting…') // show the edit bar immediately
  const ok = await ensureConnected()
  if (!ok) return
  state.connected = true
  localStorage.setItem(EDITOR_FLAG, '1') // remember this browser is an editor
  await ensureSynced() // empty folder → pull; stale copy → offer re-sync
  await loadModel()
  await loadAssetUrls() // read content/_assets from disk → in-memory blob URLs
  try {
    await applyTemplateShell() // rebuild the page from content/template.html (disk)
  } catch (err) {
    setStatus('Could not read content/template.html: ' + (err as Error).message)
    return
  }
  setStatus('Connected. Edits stay in memory until you Save.')
  updateSaveButton() // now that we're connected, reveal Save + Publish
  document.addEventListener('click', onNavClick)
  window.addEventListener('hashchange', () => renderRoute())
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault()
      e.returnValue = '' // prompt before losing unsaved in-memory edits
    }
  })
  renderNav()
  renderRoute()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  void boot()
}

if (import.meta.hot) import.meta.hot.accept()

export { isEditMode }
