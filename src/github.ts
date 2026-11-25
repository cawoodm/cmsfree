// GitHub: per-site settings + dialog, the REST helper, pull (repo -> content files),
// publish (changed files -> one commit via the Git Data API) and build status polling.
// No storage and no page access: callers pass files in and get results back.
import { dialog } from './chrome'
import { SITE_CONFIG, blobSha, isSitePath } from './format'
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
  return { owner: s.owner || d?.owner || '', repo: s.repo || d?.repo || '', branch: s.branch || 'main', subdir: normalizeSubdir(s.subdir), token: s.token || '' }
}

// " /site/ " or "site\" -> "site"; '' is the repo root.
export function normalizeSubdir(dir: string | undefined): string {
  return (dir || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
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
  url.hash = LINK_PARAM + toBase64Url(JSON.stringify({ v: 1, owner: s.owner, repo: s.repo, branch: s.branch, subdir: s.subdir, token: s.token }))
  return url.toString()
}

// If the URL carries a setup link: store its settings for this site and remove it from the address bar and history.
// 'none' = no setup link, 'invalid' = a damaged or incomplete link (nothing stored).
export function importSetupLink(): 'none' | 'imported' | 'invalid' {
  if (!location.hash.startsWith('#' + LINK_PARAM)) return 'none'
  const encoded = location.hash.slice(1 + LINK_PARAM.length)
  history.replaceState(null, '', location.pathname + location.search)
  try {
    const d = JSON.parse(fromBase64Url(encoded))
    const s: Settings = { owner: String(d.owner || ''), repo: String(d.repo || ''), branch: String(d.branch || 'main'), subdir: normalizeSubdir(String(d.subdir || '')), token: String(d.token || '') }
    if (!settingsComplete(s)) return 'invalid'
    saveSettings(s)
    return 'imported'
  } catch {
    return 'invalid'
  }
}

export function settingsComplete(s: Settings): boolean {
  return !!(s.owner && s.repo && s.branch)
}

// Name of the OPFS folder for this repo + branch (+ site folder, if any).
export function siteFolderName(s: Settings): string {
  return [s.owner, s.repo, s.branch, ...(s.subdir ? [s.subdir] : [])].map((p) => p.replace(/[^\w.-]/g, '_')).join('__')
}

// The repo (and the site folder in it) on github.com.
export function githubUrl(s: Settings): string {
  return `https://github.com/${s.owner}/${s.repo}/tree/${s.branch}${s.subdir ? '/' + s.subdir : ''}`
}

const GITHUB_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

// Resolves true when the user saved, false on cancel. `onDownload` adds a "Download .zip" button.
// Save first checks the settings on GitHub (checkSettings): problems mark their fields red (error) or amber
// (warning) and Save becomes "Save anyway". `check` runs the check as soon as the dialog opens.
export function openSettingsDialog(note?: string, check = false, onDownload?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const s = loadSettings()
    const dlg = dialog()
    dlg.innerHTML = `
      <form method="dialog">
        <h2>GitHub settings <a class="cms-gh" target="_blank" rel="noopener" title="Open on GitHub">${GITHUB_ICON}</a></h2>
        <p class="cms-note"></p>
        <label>Owner <span>user or organisation</span><input name="owner"></label>
        <label>Repository<input name="repo"></label>
        <label>Branch<input name="branch"></label>
        <label>Site folder <span>folder of the Hugo site (with hugo.toml) in the repo; empty for the repo root</span><input name="subdir" placeholder="e.g. site"></label>
        <label>Personal access token
          <span>Needs contents write access. Stored in this browser only. Optional for pulling a public repo.</span>
          <span class="cms-field"><input name="token" type="password" autocomplete="off" placeholder="ghp_…"><button type="button" class="cms-btn cms-copy-token">Copy</button></span></label>
        <label class="cms-link-box" hidden>Setup link
          <span>Opens this site in edit mode with these settings, token included. Anyone with the link can publish: send it privately.</span>
          <input name="link" readonly></label>
        <div class="cms-row">
          <button type="button" class="cms-btn cms-copy-link">Copy setup link</button>
          <button type="button" class="cms-btn cms-download" hidden title="The site files in this browser, unpublished edits included">Download .zip</button>
          <button value="cancel" class="cms-btn" type="submit">Cancel</button>
          <button value="save" class="cms-btn cms-primary cms-save" type="submit">Save</button>
        </div>
      </form>`
    const form = dlg.querySelector('form') as HTMLFormElement
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
    for (const k of ['owner', 'repo', 'branch', 'subdir', 'token'] as const) field(k).value = s[k]
    ;(dlg.querySelector('.cms-note') as HTMLElement).textContent = note || ''
    const downloadBtn = dlg.querySelector('.cms-download') as HTMLButtonElement
    if (onDownload) {
      downloadBtn.hidden = false
      downloadBtn.addEventListener('click', onDownload)
    }
    // Built from the fields as they are now (saved or not), shown for manual copying and copied to the clipboard.
    const current = (): Settings => ({
      owner: field('owner').value.trim(),
      repo: field('repo').value.trim(),
      branch: field('branch').value.trim() || 'main',
      subdir: normalizeSubdir(field('subdir').value),
      token: field('token').value.trim(),
    })
    // Copies the token as typed. Without clipboard access it shows and selects the token for manual copying.
    const copyToken = dlg.querySelector('.cms-copy-token') as HTMLButtonElement
    copyToken.addEventListener('click', () => {
      const token = field('token').value.trim()
      if (!token) return
      const reveal = () => {
        field('token').type = 'text'
        field('token').select()
      }
      navigator.clipboard?.writeText(token).then(() => {
        copyToken.textContent = 'Copied'
        setTimeout(() => (copyToken.textContent = 'Copy'), 1500)
      }, reveal) ?? reveal()
    })
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
    // GitHub link: follows the fields as they are typed.
    const ghLink = dlg.querySelector('.cms-gh') as HTMLAnchorElement
    const noteEl = dlg.querySelector('.cms-note') as HTMLElement
    const saveBtn = dlg.querySelector('.cms-save') as HTMLButtonElement
    const updateLink = () => {
      const c = current()
      ghLink.hidden = !settingsComplete(c)
      ghLink.href = settingsComplete(c) ? githubUrl(c) : ''
    }
    updateLink()
    // Problem marks: a red (error) or amber (warning) field with the message under it; field '' = the note at the top.
    let checked = false // the current values were checked and have problems: Save now saves anyway
    const clearMarks = () => {
      for (const el of dlg.querySelectorAll('.cms-invalid, .cms-warn')) el.classList.remove('cms-invalid', 'cms-warn')
      for (const el of dlg.querySelectorAll('.cms-problem')) el.remove()
      noteEl.classList.remove('cms-problem-note')
      noteEl.textContent = note || ''
      checked = false
      saveBtn.textContent = 'Save'
    }
    const showProblems = (problems: Problem[]) => {
      for (const p of problems) {
        if (!p.field) {
          noteEl.textContent = p.text
          noteEl.classList.add('cms-problem-note')
          continue
        }
        const label = field(p.field).closest('label') as HTMLElement
        label.classList.add(p.warn ? 'cms-warn' : 'cms-invalid')
        const msg = document.createElement('span')
        msg.className = 'cms-problem'
        msg.textContent = p.text
        label.append(msg)
      }
      checked = problems.length > 0
      if (checked) saveBtn.textContent = 'Save anyway'
      dlg.querySelector<HTMLInputElement>('.cms-invalid input, .cms-warn input')?.focus()
    }
    const runCheck = async (): Promise<Problem[]> => {
      clearMarks()
      saveBtn.disabled = true
      saveBtn.textContent = 'Checking…'
      try {
        return await checkSettings(current())
      } finally {
        saveBtn.disabled = false
        saveBtn.textContent = 'Save'
      }
    }
    form.addEventListener('input', () => {
      updateLink()
      if (checked) clearMarks()
    })
    let saved = false
    const save = () => {
      saved = true
      saveSettings(current())
      dlg.close()
    }
    form.addEventListener('submit', (e) => {
      if (((e as SubmitEvent).submitter as HTMLButtonElement)?.value !== 'save') return
      e.preventDefault()
      if (saveBtn.disabled) return
      if (checked) return save()
      void runCheck().then((problems) => (problems.length ? showProblems(problems) : save()))
    })
    dlg.addEventListener('close', () => resolve(saved))
    dlg.showModal()
    field('owner').focus() // not the GitHub link, the first focusable element
    if (check) void runCheck().then(showProblems)
  })
}

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------
export class GhError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// Throws with the response body on failure. The token is optional: without one the
// Authorization header is omitted, so reads of a PUBLIC repo work.
export async function gh(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    // GitHub sends max-age=60: a cached branch head would hide commits made in the last minute.
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new GhError(res.status, `${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

const repoPath = (s: Settings) => `/repos/${s.owner}/${s.repo}`

// Site path <-> path in the repo: the site lives in s.subdir. null = outside the site folder.
export const toRepoPath = (s: Settings, p: string) => (s.subdir ? `${s.subdir}/${p}` : p)
const fromRepoPath = (s: Settings, p: string) => (!s.subdir ? p : p.startsWith(s.subdir + '/') ? p.slice(s.subdir.length + 1) : null)

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

// ---------------------------------------------------------------------------
// Settings check: do the repo, the branch and the site folder exist, and is there anything to edit?
// ---------------------------------------------------------------------------
export interface Problem {
  field: '' | 'owner' | 'repo' | 'branch' | 'subdir' | 'token'
  text: string
  warn?: boolean // works, but probably not what the user wants
}

export async function checkSettings(s: Settings): Promise<Problem[]> {
  const out: Problem[] = []
  if (!s.owner) out.push({ field: 'owner', text: 'Required.' })
  if (!s.repo) out.push({ field: 'repo', text: 'Required.' })
  if (out.length) return out
  const failed = (err: unknown): Problem[] => [{ field: '', text: 'Could not check the settings on GitHub: ' + (err as Error).message }]
  let repo: { default_branch: string; permissions?: { push?: boolean } }
  try {
    repo = await gh(s.token, 'GET', repoPath(s))
  } catch (err) {
    const status = (err as GhError).status
    if (status === 401) return [{ field: 'token', text: 'GitHub does not accept this token (wrong or expired).' }]
    if (status !== 404) return failed(err)
    try {
      await gh(s.token, 'GET', `/users/${s.owner}`)
    } catch (e) {
      if ((e as GhError).status === 404) return [{ field: 'owner', text: `There is no GitHub user or organisation "${s.owner}".` }]
    }
    return [
      { field: 'repo', text: s.token ? `No repository "${s.owner}/${s.repo}", or the token has no access to it.` : `No public repository "${s.owner}/${s.repo}". A private repository needs a token.` },
    ]
  }
  if (s.token && repo.permissions && !repo.permissions.push) out.push({ field: 'token', text: 'This token can read but not write the repository: publishing will fail.', warn: true })
  let commit: string
  try {
    commit = await getHead(s)
  } catch (err) {
    const status = (err as GhError).status
    if (status === 409) return [...out, { field: 'repo', text: 'The repository is empty.' }]
    if (status === 404) return [...out, { field: 'branch', text: `No branch "${s.branch}". The default branch is "${repo.default_branch}".` }]
    return [...out, ...failed(err)]
  }
  try {
    const { files } = await readTree(s, commit)
    if (!Object.keys(files).some((p) => p.startsWith('content/blocks/')))
      out.push({ field: 'subdir', text: `The site has no blocks (${s.subdir ? s.subdir + '/' : ''}content/blocks/*.md) on GitHub: there is nothing to edit.`, warn: true })
  } catch (err) {
    if (err instanceof NoSiteError) return [...out, { field: 'subdir', text: err.message }]
    return [...out, ...failed(err)]
  }
  return out
}

export class NoSiteError extends Error {}

// The site files of a commit (isSitePath: blocks, i18n strings, hugo.toml): tree sha + { site path: blob sha }.
async function readTree(s: Settings, commit: string): Promise<{ tree: string; files: Record<string, string> }> {
  const c = await gh(s.token, 'GET', `${repoPath(s)}/git/commits/${commit}`)
  const t = await gh(s.token, 'GET', `${repoPath(s)}/git/trees/${c.tree.sha}?recursive=1`)
  if (t.truncated) throw new Error('The repo tree is too large to read through the API')
  const files: Record<string, string> = {}
  for (const e of t.tree as { path: string; type: string; sha: string }[]) {
    const p = e.type === 'blob' ? fromRepoPath(s, e.path) : null
    if (p && isSitePath(p)) files[p] = e.sha
  }
  // A wrong Site folder would pull nothing and silently keep the local copy: stop and name the folders that have a hugo.toml.
  if (!files[SITE_CONFIG]) {
    const dirs = (t.tree as { path: string }[]).filter((e) => e.path === SITE_CONFIG || e.path.endsWith('/' + SITE_CONFIG)).map((e) => e.path.slice(0, -SITE_CONFIG.length - 1) || '(repo root)')
    const where = s.subdir ? `folder "${s.subdir}"` : 'the repo root'
    throw new NoSiteError(`No ${SITE_CONFIG} in ${where} of ${s.owner}/${s.repo}. ` + (dirs.length ? `Set the Site folder to: ${dirs.join(' or ')}` : 'This is not a Hugo site.'))
  }
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
    entries.push({ path: toRepoPath(s, f.path), mode: '100644', type: 'blob', sha: blob.sha })
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
