export const CART_ACTIVE_MS: number;
export const CART_KEEP_MS: number;
export const CART_LINES_MAX: number;
export type CartStatusId = 'actif' | 'abandonne' | 'commande' | 'vide';
export const CART_STATUSES: CartStatusId[];
export const CART_STATUS_LABEL: Record<CartStatusId, string>;
export type ContactWay = 'whatsapp' | 'appel' | 'email';
export const CONTACT_WAYS: ContactWay[];
export const CONTACT_LABEL: Record<ContactWay, string>;
export function cartMessage(name: string | null | undefined, count: number): string;
export function cartContactLinks(
  account: { name?: string; phone?: string; email?: string; whatsapp?: string } | null | undefined,
  count: number,
): { message: string; whatsapp: string | null; call: string | null; email: string | null };
