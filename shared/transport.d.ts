export type TransportCurrency = 'EUR' | 'XOF';
export type TransportZone = { id: string; label: string; fee: number; currency: TransportCurrency };
export type TransportFee = number | { fee: number; currency: TransportCurrency };
export const TRANSPORT_ZONES: TransportZone[];
export const CFA_ZONES: string[];
export const TRANSPORT_FEE_MAX: number;
export function transportZonesOf(value: unknown): TransportZone[];
export function validateTransport(value: unknown): { errors: Record<string, string>; value: Record<string, TransportFee> };
