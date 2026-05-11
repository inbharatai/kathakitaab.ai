// Server-side sign-out. POST to /auth/signout clears the Supabase
// session cookies and redirects home. Using POST means it can't be
// triggered by a third-party <img> or <a href>.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerAuthClient } from '@/lib/auth/supabaseAuthClient';

export async function POST(request: Request) {
  const jar = await cookies();
  const client = createServerAuthClient({
    getAll: () => jar.getAll().map(c => ({ name: c.name, value: c.value })),
    setAll: (cookieList) => {
      for (const { name, value, options } of cookieList) {
        try {
          jar.set({ name, value, ...options });
        } catch { /* RSC quirk; ignore */ }
      }
    },
  });
  if (client) await client.auth.signOut();
  const next = new URL(request.url).searchParams.get('next') || '/';
  return NextResponse.redirect(new URL(next, request.url));
}
