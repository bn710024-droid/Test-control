export type PaymentMethod = { id: string; title: string; detail: string; icon: string };
export const PAYMENT_METHODS: PaymentMethod[];
export function paymentStates(value: unknown): Record<string, boolean>;
export function publishedPayments(value: unknown): PaymentMethod[];
export function validatePayments(value: unknown): { errors: Record<string, string>; value: Record<string, boolean> };
