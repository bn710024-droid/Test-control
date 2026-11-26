import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import supabase from '../lib/supabase';
import { api, messageOf } from '../lib/api';
import { OPEN_ACCESS } from '../../shared/access.js';

export type Role = 'owner' | 'editor' | 'pending' | null;

type Me = { id: string; email: string; provider: string; role: Role; canClaim: boolean };

export type Access =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; role: Role; canClaim: boolean; provider: string };

type AuthValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Droits du compte, tels que le serveur les a confirmés. */
  access: Access;
  isOwner: boolean;
  /** Vrai : compte autorisé à modifier. Faux : mode visite, lecture seule. */
  canEdit: boolean;
  refreshAccess: () => Promise<void>;
  requestAccess: () => Promise<void>;
  claimOwnership: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<Access>({ status: 'idle' });
  const checkedFor = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;

  const load = useCallback(async () => {
    setAccess({ status: 'loading' });
    try {
      const me = await api<Me>('/api/me');
      setAccess({ status: 'ready', role: me.role, canClaim: me.canClaim, provider: me.provider });
    } catch (err) {
      setAccess({ status: 'error', error: messageOf(err) });
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      checkedFor.current = null;
      setAccess({ status: 'idle' });
      return;
    }
    if (checkedFor.current === userId) return;
    checkedFor.current = userId;
    load();
  }, [userId, load]);

  const act = useCallback(async (action: 'request' | 'claim') => {
    const me = await api<Me>('/api/me', { method: 'POST', body: { action } });
    setAccess({ status: 'ready', role: me.role, canClaim: me.canClaim, provider: me.provider });
  }, []);

  const value: AuthValue = {
    user: session?.user ?? null,
    session,
    loading,
    access,
    // Phase de test (shared/access.js) : tout est ouvert, sans connexion.
    isOwner: OPEN_ACCESS || (access.status === 'ready' && access.role === 'owner'),
    canEdit: OPEN_ACCESS || (!!session?.user && access.status === 'ready' && (access.role === 'owner' || access.role === 'editor')),
    refreshAccess: load,
    requestAccess: () => act('request'),
    claimOwnership: () => act('claim'),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors de AuthProvider');
  return ctx;
}
