// Shared state + core types + constants for the cmsfree engine.
// Everything else imports from here; this module imports nothing.

// ---- FSA type shims (permission methods aren't in the standard DOM lib) ----
type Perm = 'granted' | 'denied' | 'prompt'
export interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>
}
export type Entries = AsyncIterable<[string, FileSystemHandle]>
declare global {
  interface Window {
    showDirectoryPicker(o?: { mode?: 'read' | 'readwrite' }): Promise<DirHandle>
  }
}

export const EDITOR_FLAG = 'cmsfree:editor'
export const SETTINGS_PREFIX = 'cmsfree:github:'
export const MODE_PREFIX = 'cmsfree:mode:'
export const META_PATH = '.cmsfree/meta.json'

export type Mode = 'browser' | 'folder'

export interface Settings {
  owner: string
  repo: string
  branch: string
  token: string
}

// The base: what the repo looked like at the last pull or publish.
export interface Meta {
  commit: string
  tree: string
  files: Record<string, string> // content path -> git blob sha
}

// content path ("content/en/HERO.md", "content/site.yml") -> raw file text
export const model = new Map<string, string>()

export const state = {
  mode: null as Mode | null,
  root: null as FileSystemDirectoryHandle | null, // OPFS site folder or the picked local folder
  siteKey: '', // per-site key for settings, mode and folder handle (host + first path segment on github.io)
  dirs: [] as string[], // folder names under content/ (sorted); each one is a page
  dir: '', // folder of the page being edited ('' = the root page, content/ itself)
  base: null as Meta | null,
  dirty: new Set<string>(), // model paths not yet written to storage
  savePending: false,
}
