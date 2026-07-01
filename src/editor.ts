// Editing UI — content toolbar + source editor (memory only; disk on Save).
import { state, model } from './state'
import { currentSectionSlug, currentIsBlock } from './model'
import { currentRoute } from './routes'
import { markDirty } from './save'
import { setStatus } from './chrome'
import { contentEl, navControl, renderNav, renderCurrent } from './view'
import { createBlock, renameBlock, deleteBlock } from './crud'

export function addEditAffordance(): void {
  const el = contentEl()
  if (!el || el.querySelector('.cms-toolbar')) return
  const bar = document.createElement('div')
  bar.className = 'cms-toolbar'

  const pencil = document.createElement('button')
  pencil.className = 'cms-edit-icon'
  pencil.type = 'button'
  pencil.title = 'Edit this page'
  pencil.textContent = '✎'
  pencil.addEventListener('click', openEditor)
  bar.append(pencil)

  const section = currentSectionSlug() || currentRoute()
  if (section)
    bar.append(
      navControl('＋ block', 'Add a block to this section', () =>
        createBlock(),
      ),
    )
  if (currentIsBlock()) {
    bar.append(
      navControl('✎ name', 'Rename this block', () => renameBlock()),
      navControl('🗑 block', 'Delete this block', () => deleteBlock()),
    )
  }
  el.prepend(bar)
}

export function openEditor(): void {
  const el = contentEl()
  if (!el) return
  el.innerHTML = ''

  const textarea = document.createElement('textarea')
  textarea.className = 'cms-editor'
  textarea.value = state.currentText
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeEditor(false)
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      closeEditor(true, textarea.value)
    }
  })

  const actions = document.createElement('div')
  actions.className = 'cms-editor-actions'
  const applyBtn = document.createElement('button')
  applyBtn.className = 'cms-btn cms-btn-save'
  applyBtn.textContent = 'OK'
  applyBtn.title = 'Confirm this edit (use Save at the top to write to disk)'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'cms-btn cms-btn-cancel'
  cancelBtn.textContent = 'Cancel'
  applyBtn.addEventListener('click', () => closeEditor(true, textarea.value))
  cancelBtn.addEventListener('click', () => closeEditor(false))

  actions.append(applyBtn, cancelBtn)
  el.append(textarea, actions)
  textarea.focus()
}

export function closeEditor(apply: boolean, newText?: string): void {
  if (apply && newText !== undefined) {
    model.set(state.currentPath, newText)
    state.currentText = newText
    markDirty()
    if (state.currentPath.endsWith('/index.md')) renderNav() // title/order may have changed
    setStatus(
      'Applied to ' +
        state.currentPath +
        ' (unsaved). Click Save to write to disk.',
    )
  }
  renderCurrent()
}
