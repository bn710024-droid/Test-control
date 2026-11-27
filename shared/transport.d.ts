export type TransportZone = { id: string; label: string; fee: number };
export const TRANSPORT_ZONES: TransportZone[];
export const TRANSPORT_FEE_MAX: number;
export function transportZonesOf(value: unknown): TransportZone[];
export function validateTransport(value: unknown): { errors: Record<string, string>; value: Record<string, number> };
