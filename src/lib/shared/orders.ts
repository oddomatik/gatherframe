export const ORDER_STATUSES = ['new', 'in_progress', 'printed', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['in_progress', 'printed', 'cancelled'],
  in_progress: ['printed', 'new', 'cancelled'],
  printed: ['delivered', 'in_progress', 'cancelled'],
  delivered: ['printed'],
  cancelled: ['new']
};

export function allowedTransitions(from: OrderStatus): OrderStatus[] { return TRANSITIONS[from] ?? []; }
export function canTransition(from: OrderStatus, to: OrderStatus): boolean { return allowedTransitions(from).includes(to); }

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New', in_progress: 'In progress', printed: 'Printed', delivered: 'Delivered', cancelled: 'Cancelled'
};

export const PAYMENT_METHODS = ['cash', 'venmo', 'check', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
