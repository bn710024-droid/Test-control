import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Faux quand les variables d'environnement manquent : l'application l'explique au lieu de planter. */
export const configured = !!url && !!key;

/**
 * Client du navigateur. Il ne sert qu'à la connexion : toutes les lectures et écritures du
 * catalogue passent par les routes /api, qui vérifient le rôle côté serveur.
 */
const supabase = createClient(url || 'https://configuration-manquante.invalid', key || 'manquante');

export default supabase;
