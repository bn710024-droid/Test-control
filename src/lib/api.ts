import supabase from './supabase';
import { withSpace } from './space';

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(message: string, status: number, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Session expirée. Reconnectez-vous.',
  403: 'Ce compte n’a pas le droit de faire cette action.',
  404: 'Introuvable : la page ou la donnée n’existe plus.',
  409: 'Conflit : les données ont changé entre-temps. Rechargez.',
  413: 'Envoi trop volumineux.',
  500: 'Le serveur n’a pas pu traiter la demande. Réessayez dans un instant.',
};

/** Appel d'une route /api avec le jeton de la session. Lève une `ApiError` lisible en cas d'échec. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(withSpace(path), {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : null),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('Connexion impossible. Vérifiez le réseau, puis réessayez.', 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Réponse sans corps lisible : le statut suffit.
  }
  if (!res.ok) {
    const body = (json ?? {}) as { error?: string; fields?: Record<string, string> };
    throw new ApiError(
      body.error || FALLBACK[res.status] || `Erreur ${res.status}. Réessayez dans un instant.`,
      res.status,
      body.fields,
    );
  }
  return json as T;
}

export const messageOf = (err: unknown) =>
  err instanceof Error && err.message ? err.message : 'Une erreur inattendue est survenue.';
