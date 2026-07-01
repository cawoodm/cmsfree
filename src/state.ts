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

export const VERSION_PATH = 'content/version.json'
export const EDITOR_FLAG = 'cmsfree:editor'
export const GH_KEY = 'cmsfree:github'

export interface Section {
  slug: string
  title: string
  order: number
}

// content-relative path -> raw file text
export const model = new Map<string, string>()

// The single mutable state singleton (was module-level `let`s in cms.ts).
export const state = {
  dirHandle: null as DirHandle | null,
  connected: false,
  dirty: false,
  loaded: false,
  currentText: '', // raw text (frontmatter + body) of the loaded route
  currentPath: '', // content-relative path of the loaded route
}
