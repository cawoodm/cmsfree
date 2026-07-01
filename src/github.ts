// GitHub Pages deploy — push the publish/ tree to a branch via the Git Data
// API. Settings (token, owner, repo, branch, commit prefix) persist to
// localStorage and are edited via a dialog. Commit message = prefix + version.
import { GH_KEY } from './state'
import type { Entries } from './state'
import { resolveDir, readFile } from './disk'
import { setStatus } from './chrome'

interface GhSettings {
  token: string
  owner: string
  repo: string
  branch: string
  subdir: string
  commitPrefix: string
}

function loadGhSettings(): GhSettings {
  let s: Partial<GhSettings> = {}
  try {
    s = JSON.parse(localStorage.getItem(GH_KEY) || '{}')
  } catch {
    /* ignore malformed */
  }
  return {
    token: s.token || '',
    owner: s.owner || '',
    repo: s.repo || '',
    branch: s.branch || 'main',
    subdir: s.subdir || '',
    commitPrefix: s.commitPrefix || 'Publish site',
  }
}

function saveGhSettings(s: GhSettings): void {
  localStorage.setItem(GH_KEY, JSON.stringify(s))
}

export function openSettingsDialog(note?: string): void {
  let dlg = document.getElementById('cms-settings') as HTMLDialogElement | null
  if (!dlg) {
    dlg = document.createElement('dialog')
    dlg.id = 'cms-settings'
    dlg.innerHTML = `
      <form method="dialog" class="cms-settings-form">
        <h2>Deploy to GitHub Pages</h2>
        <p class="cms-settings-note"></p>
        <label>Personal access token
          <span>repo scope — stored in this browser's localStorage</span>
          <input name="token" type="password" autocomplete="off" placeholder="ghp_…"></label>
        <label>Owner <span>user or org</span><input name="owner" placeholder="octocat"></label>
        <label>Repository<input name="repo" placeholder="my-site"></label>
        <label>Branch<input name="branch" placeholder="main"></label>
        <label>Subdirectory
          <span>optional — deploy into this folder of the branch instead of its root; other paths on the branch are left untouched</span>
          <input name="subdir" placeholder="e.g. my-site"></label>
        <label>Commit message prefix<input name="commitPrefix" placeholder="Publish site"></label>
        <div class="cms-settings-actions">
          <button value="cancel" class="cms-btn cms-btn-cancel" type="submit">Cancel</button>
          <button value="save" class="cms-btn cms-btn-save" type="submit">Save</button>
        </div>
      </form>`
    document.body.append(dlg)
    const form = dlg.querySelector('form') as HTMLFormElement
    form.addEventListener('submit', (e) => {
      if (((e as SubmitEvent).submitter as HTMLButtonElement)?.value !== 'save')
        return
      const fd = new FormData(form)
      saveGhSettings({
        token: String(fd.get('token') || ''),
        owner: String(fd.get('owner') || '').trim(),
        repo: String(fd.get('repo') || '').trim(),
        branch: String(fd.get('branch') || '').trim() || 'main',
        subdir: String(fd.get('subdir') || '')
          .trim()
          .replace(/^\/+|\/+$/g, ''),
        commitPrefix:
          String(fd.get('commitPrefix') || '').trim() || 'Publish site',
      })
      setStatus('GitHub deploy settings saved.')
    })
  }
  const s = loadGhSettings()
  const form = dlg.querySelector('form') as HTMLFormElement
  ;(form.elements.namedItem('token') as HTMLInputElement).value = s.token
  ;(form.elements.namedItem('owner') as HTMLInputElement).value = s.owner
  ;(form.elements.namedItem('repo') as HTMLInputElement).value = s.repo
  ;(form.elements.namedItem('branch') as HTMLInputElement).value = s.branch
  ;(form.elements.namedItem('subdir') as HTMLInputElement).value = s.subdir
  ;(form.elements.namedItem('commitPrefix') as HTMLInputElement).value =
    s.commitPrefix
  ;(dlg.querySelector('.cms-settings-note') as HTMLElement).textContent =
    note || ''
  dlg.showModal()
}

// base64-encode an ArrayBuffer (handles text + binary assets uniformly).
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// Recursively read every file under publish/ as {path, base64}.
async function collectPublishFiles(): Promise<
  { path: string; base64: string }[]
> {
  const out: { path: string; base64: string }[] = []
  async function walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const [name, h] of (dir as any).entries() as Entries) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (h.kind === 'file') {
        const buf = await (
          await (h as FileSystemFileHandle).getFile()
        ).arrayBuffer()
        out.push({ path: rel, base64: toBase64(buf) })
      } else if (h.kind === 'directory') {
        await walk(h as FileSystemDirectoryHandle, rel)
      }
    }
  }
  await walk(await resolveDir(['publish']), '')
  return out
}

// Thin GitHub REST helper. Throws with the response body on failure.
async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`,
    )
  }
  return res.status === 204 ? null : res.json()
}

export async function deployToGitHub(): Promise<void> {
  const s = loadGhSettings()
  if (!s.token || !s.owner || !s.repo) {
    openSettingsDialog('Enter your token, owner and repo to deploy.')
    return
  }
  const gitBase = `/repos/${s.owner}/${s.repo}/git`
  const prefix = s.subdir ? `${s.subdir}/` : ''
  const btn = document.querySelector(
    '#cms-banner .cms-deploy',
  ) as HTMLButtonElement | null
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Deploying…'
  }
  try {
    let version = 0
    try {
      version = JSON.parse(await readFile('publish/version.json')).version ?? 0
    } catch {
      /* keep 0 */
    }
    const message = `${s.commitPrefix} v${version}`

    const files = await collectPublishFiles()
    if (files.length === 0)
      throw new Error('publish/ is empty — click Publish first')
    setStatus(`Deploying ${files.length} files to ${s.owner}/${s.repo}…`)

    // 1. Upload each file as a blob.
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] =
      []
    for (const f of files) {
      const blob = await gh(s.token, 'POST', `${gitBase}/blobs`, {
        content: f.base64,
        encoding: 'base64',
      })
      tree.push({
        path: prefix + f.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      })
    }
    // 2. Find the branch head, if the branch already exists.
    let parents: string[] = []
    let branchExists = false
    try {
      const ref = await gh(s.token, 'GET', `${gitBase}/ref/heads/${s.branch}`)
      parents = [ref.object.sha]
      branchExists = true
    } catch {
      /* branch doesn't exist yet → first (root) commit */
    }
    // 3. Build the full tree. With no subdirectory, replace the whole branch
    // (matches every prior version of this feature). With a subdirectory, keep
    // every path outside it as-is — other projects can share the same branch —
    // and only replace what's under the subdirectory (which also prunes files
    // removed from this site, since none of its old paths are carried over).
    let entries = tree
    if (prefix && branchExists) {
      const headCommit = await gh(
        s.token,
        'GET',
        `${gitBase}/commits/${parents[0]}`,
      )
      const baseTree = await gh(
        s.token,
        'GET',
        `${gitBase}/trees/${headCommit.tree.sha}?recursive=1`,
      )
      const outside = (
        baseTree.tree as {
          path: string
          mode: string
          type: string
          sha: string
        }[]
      ).filter((e) => e.type === 'blob' && !e.path.startsWith(prefix))
      entries = [...outside, ...tree]
    }
    const newTree = await gh(s.token, 'POST', `${gitBase}/trees`, {
      tree: entries,
    })
    // 4. Commit.
    const commit = await gh(s.token, 'POST', `${gitBase}/commits`, {
      message,
      tree: newTree.sha,
      parents,
    })
    // 5. Point the branch at the new commit (create it if new).
    if (branchExists) {
      await gh(s.token, 'PATCH', `${gitBase}/refs/heads/${s.branch}`, {
        sha: commit.sha,
        force: true,
      })
    } else {
      await gh(s.token, 'POST', `${gitBase}/refs`, {
        ref: `refs/heads/${s.branch}`,
        sha: commit.sha,
      })
    }
    // 6. Best-effort: enable Pages on this branch (ignored if already enabled).
    try {
      await gh(s.token, 'POST', `/repos/${s.owner}/${s.repo}/pages`, {
        source: { branch: s.branch, path: '/' },
      })
    } catch {
      /* already enabled or insufficient scope — not fatal */
    }
    setStatus(
      `Deployed "${message}" to ${s.owner}/${s.repo}@${s.branch}${prefix ? '/' + s.subdir : ''}. Live at https://${s.owner}.github.io/${s.repo}/${prefix}`,
    )
  } catch (err) {
    setStatus('Deploy failed: ' + (err as Error).message)
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Deploy'
    }
  }
}
