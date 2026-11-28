export type Fees = { XOF: number | null; EUR: number | null; USD: number | null };
export type TransportZone = { id: string; label: string; fees: Fees };
export const TRANSPORT_ZONES: { id: string; label: string; fee: number }[];
export const TRANSPORT_FEE_MAX: number;
export function feesOf(value: unknown): Fees;
export function transportZonesOf(value: unknown): TransportZone[];
export function validateTransport(value: unknown): { errors: Record<string, string>; value: Record<string, Fees> };
