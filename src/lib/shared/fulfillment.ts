export const PHOTO_WORK_STATES = ['needs_review', 'needs_touchup', 'ready'] as const;
export type PhotoWorkState = typeof PHOTO_WORK_STATES[number];
export const WORK_LABELS = { needs_review: 'Needs review', needs_touchup: 'Needs touch-ups', ready: 'Ready to print' } as const;
export const FULFILLMENT_LABELS = { review: 'Review', touchups: 'Touch-ups', ready: 'Ready to print', printed: 'Printed', delivered: 'Delivered', cancelled: 'Cancelled' } as const;
export type FulfillmentStage = keyof typeof FULFILLMENT_LABELS;
