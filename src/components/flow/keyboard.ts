/**
 * Board-wide keyboard shortcuts must never fire while the user is typing:
 * Delete means "delete a character", Ctrl+Z means "undo my typing", Ctrl+C
 * means "copy my text". Anything that handles board keys checks here first.
 */
export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
