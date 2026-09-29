/** Existing subject_label values are retained; new projects use an exact, neutral field label. */
export const DEFAULT_ORDER_REFERENCE_LABEL = 'Order reference';
export function normalizeOrderReferenceLabel(value?: string | null): string {
  const label = value?.trim().replace(/\s+/g, ' ') || DEFAULT_ORDER_REFERENCE_LABEL;
  if (label.length > 80) throw new Error('The order reference label must be 80 characters or fewer.');
  return label;
}
/** Render legacy role choices as before, without silently relabeling an existing project. */
export function orderReferenceLabel(value?: string | null): string {
  const label = value?.trim() || DEFAULT_ORDER_REFERENCE_LABEL;
  if (['child', 'player', 'family', 'couple', 'group', 'collection'].includes(label))
    return `${label[0].toUpperCase()}${label.slice(1)} name(s)`;
  return label;
}
