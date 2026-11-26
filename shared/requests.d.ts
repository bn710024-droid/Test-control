export type RequestMessage = { enabled: boolean; title: string; body: string; placeholder: string; button: string; thanks: string };
export type RequestMessageKey = Exclude<keyof RequestMessage, 'enabled'>;
export const DEFAULT_REQUEST_MESSAGE: RequestMessage;
export const REQUEST_MESSAGE_LIMITS: Record<RequestMessageKey, number>;
export function requestMessageOf(raw: unknown): RequestMessage;
export function validateRequestMessage(input: unknown): { errors: Partial<Record<RequestMessageKey, string>>; value: RequestMessage };

export type RequestStatus = 'nouvelle' | 'etude' | 'prevenu' | 'ecartee';
export const REQUEST_STATUSES: { id: RequestStatus; label: string; detail: string; open: boolean }[];
export function isRequestStatus(id: unknown): id is RequestStatus;
export function requestStatusLabel(id: unknown): string;
export function isRequestOpen(id: unknown): boolean;
export function requestKey(text: unknown): string;

/** Une demande de produit introuvable, telle que l'équipe la lit. */
export type ProductRequest = {
  id: string;
  /** Le produit recherché, avec les mots du client. */
  product: string;
  /** Précision facultative du client : variété, quantité, usage. */
  details: string;
  customer: { account_id: string; name: string; type: 'particulier' | 'pro'; company: string; email: string; phone: string; whatsapp: string };
  country: string;
  status: RequestStatus;
  status_at: string;
  /** Note interne de l'équipe : jamais montrée au client. */
  note: string;
  history: { status: RequestStatus; at: string }[];
  created_at: string;
  received_at: string;
};
