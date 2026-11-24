// GitHub: per-site settings + dialog, the REST helper, pull (repo -> content files),
// publish (changed files -> one commit via the Git Data API) and build status polling.
// No storage and no page access: callers pass files in and get results back.
import { dialog } from './chrome'
import { blobSha, isSitePath } from './format'
import { SETTINGS_PREFIX } from './state'
import type { Meta, Settings } from './state'

export { blobSha }

// ---------------------------------------------------------------------------
// Site identity + settings
// ---------------------------------------------------------------------------
// On <owner>.github.io the owner comes from the host. Pages live at /, /<dir>/ (user site) or /<repo>/, /<repo>/<dir>/ (project site); <html lang> tells a folder page from a repo folder.
export function detectSite(): { owner: string; repo: string } | null {
  if (!location.hostname.endsWith('.github.io')) return null
  const owner = location.hostname.split('.')[0]
  const lang = document.documentElement.lang
  const dirs = location.pathname.split('/').filter((p) => p && !p.includes('.'))
  const repo = dirs.length >= 2 || (dirs.length === 1 && dirs[0] !== lang) ? dirs[0] : `${owner}.github.io`
  return { owner, repo }
}

// Key of one site: the host, plus the repo on github.io (several sites share that origin).
export function siteKey(): string {
  const d = detectSite()
  return d ? `${location.host}/${d.repo}` : location.host
}

export function loadSettings(): Settings {
  let s: Partial<Settings> = {}
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_PREFIX + siteKey()) || '{}')
  } catch {
    /* ignore malformed */
  }
  const d = detectSite()
  return { owner: s.owner || d?.owner || '', repo: s.repo || d?.repo || '', branch: s.branch || 'main', token: s.token || '' }
}

function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_PREFIX + siteKey(), JSON.stringify(s))
}

// ---------------------------------------------------------------------------
// Setup link: all settings (token included) in the URL fragment, so one link sets up another browser.
// The fragment is never sent to a server or in a Referer header. Base64 is encoding, not encryption.
// ---------------------------------------------------------------------------
const LINK_PARAM = 'cmsfree='

function toBase64Url(text: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

// This page in edit mode, with the settings in the fragment.
export function setupLink(s: Settings): string {
  const url = new URL(location.href)
  if (!new URLSearchParams(url.search.toLowerCase()).has('edit')) url.search = url.search ? url.search + '&edit' : '?edit'
  url.hash = LINK_PARAM + toBase64Url(JSON.stringify({ v: 1, owner: s.owner, repo: s.repo, branch: s.branch, token: s.token }))
  return url.toString()
}

// If the URL carries a setup link: store its settings for this site and remove it from the address bar and history.
export function importSetupLink(): boolean {
  if (!location.hash.startsWith('#' + LINK_PARAM)) return false
  const encoded = location.hash.slice(1 + LINK_PARAM.length)
  history.replaceState(null, '', location.pathname + location.search)
  try {
    const d = JSON.parse(fromBase64Url(encoded))
    const s: Settings = { owner: String(d.owner || ''), repo: String(d.repo || ''), branch: String(d.branch || 'main'), token: String(d.token || '') }
    if (!settingsComplete(s)) return false
    saveSettings(s)
    return true
  } catch {
    return false
  }
}

export function settingsComplete(s: Settings): boolean {
  return !!(s.owner && s.repo && s.branch)
}

// Name of the OPFS folder for this repo + branch.
export function siteFolderName(s: Settings): string {
  return [s.owner, s.repo, s.branch].map((p) => p.replace(/[^\w.-]/g, '_')).join('__')
}

// Resolves true when the user saved, false on cancel. `onChangeMode` adds a "change storage mode" button.
export function openSettingsDialog(note?: string, onChangeMode?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const s = loadSettings()
    const dlg = dialog()
    dlg.innerHTML = `
      <form method="dialog">
        <h2>GitHub settings</h2>
        <p class="cms-note"></p>
        <label>Owner <span>user or organisation</span><input name="owner"></label>
        <label>Repository<input name="repo"></label>
        <label>Branch<input name="branch"></label>
        <label>Personal access token
          <span>Needs contents write access. Stored in this browser only. Optional for pulling a public repo.</span>
          <input name="token" type="password" autocomplete="off" placeholder="ghp_…"></label>
        <label class="cms-link-box" hidden>Setup link
          <span>Opens this site in edit mode with these settings, token included. Anyone with the link can publish: send it privately.</span>
          <input name="link" readonly></label>
        <div class="cms-row">
          <button type="button" class="cms-btn cms-copy-link">Copy setup link</button>
          <button type="button" class="cms-btn cms-mode" hidden>Change storage mode</button>
          <button value="cancel" class="cms-btn" type="submit">Cancel</button>
          <button value="save" class="cms-btn cms-primary" type="submit">Save</button>
        </div>
      </form>`
    const form = dlg.querySelector('form') as HTMLFormElement
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
    for (const k of ['owner', 'repo', 'branch', 'token'] as const) field(k).value = s[k]
    ;(dlg.querySelector('.cms-note') as HTMLElement).textContent = note || ''
    const modeBtn = dlg.querySelector('.cms-mode') as HTMLButtonElement
    if (onChangeMode) {
      modeBtn.hidden = false
      modeBtn.addEventListener('click', onChangeMode)
    }
    // Built from the fields as they are now (saved or not), shown for manual copying and copied to the clipboard.
    const current = (): Settings => ({ owner: field('owner').value.trim(), repo: field('repo').value.trim(), branch: field('branch').value.trim() || 'main', token: field('token').value.trim() })
    dlg.querySelector('.cms-copy-link')!.addEventListener('click', () => {
      const s = current()
      const box = dlg.querySelector('.cms-link-box') as HTMLElement
      const span = box.querySelector('span') as HTMLElement
      if (!settingsComplete(s)) {
        box.hidden = false
        span.textContent = 'Enter owner and repository first.'
        field('link').value = ''
        return
      }
      const link = setupLink(s)
      box.hidden = false
      field('link').value = link
      field('link').select()
      const note = s.token ? 'Token included: anyone with the link can publish. Send it privately.' : 'No token included: the link can pull, but publishing needs a token.'
      navigator.clipboard?.writeText(link).then(
        () => (span.textContent = 'Copied. ' + note),
        () => (span.textContent = 'Copy it from the field below. ' + note),
      ) ?? (span.textContent = 'Copy it from the field below. ' + note)
    })
    let saved = false
    form.addEventListener('submit', (e) => {
      if (((e as SubmitEvent).submitter as HTMLButtonElement)?.value !== 'save') return
      saved = true
      saveSettings(current())
    })
    dlg.addEventListener('close', () => resolve(saved))
    dlg.showModal()
  })
}

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------
// Throws with the response body on failure. The token is optional: without one the
// Authorization header is omitted, so reads of a PUBLIC repo work.
export async function gh(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

const repoPath = (s: Settings) => `/repos/${s.owner}/${s.repo}`

// Decode a GitHub-API base64 payload (line-wrapped) to a UTF-8 string.
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Current head commit sha of the branch.
export async function getHead(s: Settings): Promise<string> {
  const ref = await gh(s.token, 'GET', `${repoPath(s)}/git/ref/heads/${s.branch}`)
  return ref.object.sha
}

// The site files of a commit (isSitePath: blocks, i18n strings, hugo.toml): tree sha + { path: blob sha }.
async function readTree(s: Settings, commit: string): Promise<{ tree: string; files: Record<string, string> }> {
  const c = await gh(s.token, 'GET', `${repoPath(s)}/git/commits/${commit}`)
  const t = await gh(s.token, 'GET', `${repoPath(s)}/git/trees/${c.tree.sha}?recursive=1`)
  if (t.truncated) throw new Error('The repo tree is too large to read through the API')
  const files: Record<string, string> = {}
  for (const e of t.tree as { path: string; type: string; sha: string }[]) if (e.type === 'blob' && isSitePath(e.path)) files[e.path] = e.sha
  return { tree: c.tree.sha, files }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
// ref -> commit -> recursive tree -> blobs of the site files. Returns the texts and the new base.
export async function pull(s: Settings): Promise<{ files: Record<string, string>; meta: Meta }> {
  const commit = await getHead(s)
  const { tree, files } = await readTree(s, commit)
  const texts: Record<string, string> = {}
  const paths = Object.keys(files)
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(
      paths.slice(i, i + 8).map(async (p) => {
        const blob = await gh(s.token, 'GET', `${repoPath(s)}/git/blobs/${files[p]}`)
        texts[p] = fromBase64(blob.content)
      }),
    )
  }
  return { files: texts, meta: { commit, tree, files } }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------
export class ConflictError extends Error {
  constructor(public paths: string[]) {
    super('Changed on GitHub since your last sync: ' + paths.join(', '))
  }
}

export interface PublishResult {
  meta: Meta
  moved: boolean // the branch had moved on; local content should be pulled again
}

// One commit with the changed files on top of the branch head. Throws ConflictError
// when a changed file was also changed on GitHub since the base.
export async function publish(s: Settings, changed: { path: string; text: string; sha: string }[], base: Meta): Promise<PublishResult> {
  const head = await getHead(s)
  const moved = head !== base.commit
  let baseTree = base.tree
  if (moved) {
    const remote = await readTree(s, head)
    const conflicts = changed.filter((f) => remote.files[f.path] && remote.files[f.path] !== base.files[f.path] && remote.files[f.path] !== f.sha).map((f) => f.path)
    if (conflicts.length) throw new ConflictError(conflicts)
    baseTree = remote.tree
  }
  const git = `${repoPath(s)}/git`
  const entries: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = []
  for (const f of changed) {
    const blob = await gh(s.token, 'POST', `${git}/blobs`, { content: f.text, encoding: 'utf-8' })
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const tree = await gh(s.token, 'POST', `${git}/trees`, { base_tree: baseTree, tree: entries })
  const names = changed.map((f) => f.path.replace(/^content\//, '')).join(', ')
  const commit = await gh(s.token, 'POST', `${git}/commits`, { message: `Edit content: ${names}`, tree: tree.sha, parents: [head] })
  await gh(s.token, 'PATCH', `${git}/refs/heads/${s.branch}`, { sha: commit.sha, force: false })
  const files = { ...base.files }
  for (const f of changed) files[f.path] = f.sha
  return { meta: { commit: commit.sha, tree: tree.sha, files }, moved }
}

// ---------------------------------------------------------------------------
// Build status
// ---------------------------------------------------------------------------
export interface BuildState {
  state: 'building' | 'live' | 'failed' | 'unknown'
  url?: string
}

// Polls the workflow runs of a commit every 5 s (max 10 min). Returns a stop function.
export function watchBuild(s: Settings, sha: string, onUpdate: (b: BuildState) => void): () => void {
  const started = Date.now()
  let stopped = false
  const tick = async (): Promise<void> => {
    if (stopped) return
    let done = false
    try {
      const res = await gh(s.token, 'GET', `${repoPath(s)}/actions/runs?head_sha=${sha}`)
      const runs = res.workflow_runs as { status: string; conclusion: string | null; html_url: string }[]
      const failed = runs.find((r) => r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'skipped')
      if (failed) {
        onUpdate({ state: 'failed', url: failed.html_url })
        done = true
      } else if (runs.length && runs.every((r) => r.status === 'completed')) {
        onUpdate({ state: 'live' })
        done = true
      } else {
        onUpdate({ state: 'building' })
      }
    } catch {
      onUpdate({ state: 'building' }) // transient API error: keep polling
    }
    if (done || stopped) return
    if (Date.now() - started > 10 * 60 * 1000) {
      onUpdate({ state: 'unknown' })
      return
    }
    setTimeout(() => void tick(), 5000)
  }
  void tick()
  return () => {
    stopped = true
  }
}
