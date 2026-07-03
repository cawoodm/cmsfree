// Pull a site down from GitHub — the reverse of github.ts's deploy. Lets a
// machine with no clone bootstrap from the repo we deploy to: connect an empty
// folder and pull content/ + publish/, or re-sync a stale copy. The GitHub
// helper is token-optional, so a PUBLIC repo needs only owner/repo/branch.
//
// Reconciliation is MERGE (write-over, keep extras): files present on the repo
// overwrite their local counterparts; local-only files are left in place (a
// file deleted on the repo therefore survives locally until removed in the CMS).
import { VERSION_PATH } from './state'
import { gh, loadGhSettings } from './github'
import type { GhSettings } from './github'
import { readFile, writeBytes } from './disk'
import { setStatus } from './chrome'

// Decode a GitHub-API base64 payload (line-wrapped) to raw bytes.
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// The version recorded in the local content/version.json (0 if missing).
export async function localContentVersion(): Promise<number> {
  try {
    return JSON.parse(await readFile(VERSION_PATH)).version ?? 0
  } catch {
    return 0
  }
}

// The version of the content/ source stored on the repo, or null if it can't be
// determined (no settings, branch/file missing, offline). Best-effort.
export async function remoteContentVersion(
  s: GhSettings = loadGhSettings(),
): Promise<number | null> {
  if (!s.owner || !s.repo) return null
  const path = `${s.contentSubdir}/version.json`
  try {
    const res = await gh(
      s.token,
      'GET',
      `/repos/${s.owner}/${s.repo}/contents/${path}?ref=${encodeURIComponent(s.branch)}`,
    )
    const text = new TextDecoder().decode(fromBase64(res.content))
    return JSON.parse(text).version ?? null
  } catch {
    return null
  }
}

// Pull the repo's content/ and publish/ trees into the connected folder.
// Overwrites files that exist on the repo; leaves local-only files untouched.
export async function pullFromGitHub(
  s: GhSettings = loadGhSettings(),
): Promise<void> {
  if (!s.owner || !s.repo) throw new Error('Set owner and repo first.')
  const gitBase = `/repos/${s.owner}/${s.repo}/git`
  const pubPrefix = s.subdir ? `${s.subdir}/` : ''
  const conPrefix = `${s.contentSubdir}/`

  setStatus(`Pulling ${s.owner}/${s.repo}@${s.branch}…`)

  // Branch tip → commit → full recursive tree (same shape deploy writes).
  const ref = await gh(
    s.token,
    'GET',
    `${gitBase}/ref/heads/${encodeURIComponent(s.branch)}`,
  )
  const commit = await gh(s.token, 'GET', `${gitBase}/commits/${ref.object.sha}`)
  const tree = await gh(
    s.token,
    'GET',
    `${gitBase}/trees/${commit.tree.sha}?recursive=1`,
  )
  const blobs = (
    tree.tree as { path: string; type: string; sha: string }[]
  ).filter((e) => e.type === 'blob')

  // Map each remote blob to a local content/ or publish/ path. Content lives
  // under conPrefix; publish is what remains under pubPrefix (or, when publish
  // owns the branch root, everything that isn't content).
  const jobs: { local: string; sha: string }[] = []
  for (const e of blobs) {
    if (e.path.startsWith(conPrefix)) {
      jobs.push({
        local: 'content/' + e.path.slice(conPrefix.length),
        sha: e.sha,
      })
    } else if (pubPrefix ? e.path.startsWith(pubPrefix) : true) {
      jobs.push({
        local: 'publish/' + e.path.slice(pubPrefix.length),
        sha: e.sha,
      })
    }
  }
  if (jobs.length === 0)
    throw new Error(
      `Nothing to pull — no files under "${conPrefix}" or the publish path on ${s.branch}.`,
    )

  // Fetch each blob and write it (merge write-over).
  let done = 0
  for (const j of jobs) {
    const blob = await gh(s.token, 'GET', `${gitBase}/blobs/${j.sha}`)
    await writeBytes(j.local, fromBase64(blob.content))
    done++
    if (done % 5 === 0 || done === jobs.length)
      setStatus(`Pulling from ${s.owner}/${s.repo}… ${done}/${jobs.length}`)
  }
  setStatus(`Pulled ${jobs.length} file(s) from ${s.owner}/${s.repo}.`)
}
