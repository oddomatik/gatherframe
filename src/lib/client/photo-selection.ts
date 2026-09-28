/** Selection is by photo ID; a range always follows the current visible ordering. */
export interface SelectionModifiers { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggleOnly?: boolean; }
export function selectPhoto(selected: number[], visible: number[], anchor: number | null, clicked: number, modifiers: SelectionModifiers = {}) {
  const target = visible.indexOf(clicked);
  if (target < 0) return { selected, anchor };
  const start = anchor === null ? -1 : visible.indexOf(anchor);
  const additive = !!(modifiers.ctrlKey || modifiers.metaKey);
  if (modifiers.shiftKey) {
    const range = start < 0 ? [clicked] : visible.slice(Math.min(start, target), Math.max(start, target) + 1);
    // Range selection adds to the working batch. Earlier hand-picked photos
    // must not disappear just because the most recent anchor is elsewhere.
    return { selected: [...new Set([...selected, ...range])], anchor: start < 0 ? clicked : anchor };
  }
  return {
    selected: additive || modifiers.toggleOnly ? selected.includes(clicked) ? selected.filter(id => id !== clicked) : [...selected, clicked] : [clicked],
    anchor: clicked
  };
}
/** Keyboard activation and touch remain toggle buttons; pointer clicks use desktop modifiers. */
export function selectionModifiers(event: MouseEvent & { pointerType?: string }): SelectionModifiers {
  return { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, toggleOnly: event.pointerType === 'touch' || event.pointerType === 'pen' || event.detail === 0 };
}
/** Prevent native image/text dragging during range selection, not normal focus. */
export function preventRangeTextSelection(event: MouseEvent) { if (event.shiftKey) event.preventDefault(); }
