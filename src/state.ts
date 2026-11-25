// Shared state + core types + constants for the cmsfree engine.
// Everything else imports from here; this module imports nothing.

export type Entries = AsyncIterable<[string, FileSystemHandle]>

export const EDITOR_FLAG = 'cmsfree:editor'
export const SETTINGS_PREFIX = 'cmsfree:github:'
export const META_PATH = '.cmsfree/meta.json'

export interface Settings {
  owner: string
  repo: string
  branch: string
  subdir: string // folder of the Hugo site inside the repo; '' = repo root
  token: string
}

// The base: what the repo looked like at the last pull or publish.
export interface Meta {
  commit: string
  tree: string
  files: Record<string, string> // site path -> git blob sha
}

// site path ("content/blocks/HERO.md", "content/blocks/HERO.de.md", "i18n/en.yaml", "hugo.toml") -> raw file text
export const model = new Map<string, string>()

export const state = {
  root: null as FileSystemDirectoryHandle | null, // OPFS site folder
  siteKey: '', // per-site key for the settings (host + first path segment on github.io)
  langs: [] as string[], // the [languages.<lang>] tables of hugo.toml (sorted). [] = single-language site
  defaultLang: 'en', // defaultContentLanguage of hugo.toml
  lang: 'en', // language of the page being edited (the default language on a single-language site)
  base: null as Meta | null,
  dirty: new Set<string>(), // model paths not yet written to storage
  savePending: false,
  remoteChanged: false, // the branch on GitHub has commits that are not pulled yet
}
