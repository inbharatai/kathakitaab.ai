'use client';

// ============================================================
// useAuth — client-side hook for current user + sign-out.
//
// Subscribes to Supabase auth state changes so navbars / buttons
// update instantly on sign-in/out. Returns {user, loading} plus
// a signOut() helper. When Supabase auth isn't configured the hook
// still returns cleanly (user=null, loading=false) so the rest of
// the UI keeps working in the anonymous flow.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserAuthClient } from './supabaseAuthClient';

export interface UseAuth {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const client = useMemo(() => createBrowserAuthClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!client);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ?? null);
      setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  return {
    user,
    loading,
    signOut: async () => {
      if (!client) return;
      // Hit the route handler so server cookies get cleared too. The
      // client-side signOut() handles localStorage, but the cookie
      // session that server routes read needs the server to clear it.
      await fetch('/auth/signout', { method: 'POST' });
      await client.auth.signOut();
      // Reload so server-rendered nav + RSC components rebuild
      // without the user.
      window.location.href = '/';
    },
  };
}
