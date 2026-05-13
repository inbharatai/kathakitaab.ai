'use client';

// ============================================================
// Service-worker registration.
//
// Lives in its own client component because the root layout is a
// server component and `navigator.serviceWorker.register` must run
// in the browser. Imports public/sw.js at the root scope so it
// controls every navigation.
//
// Production-only on purpose — registering a SW in dev breaks Next's
// HMR and bakes whatever was last cached into the dev session,
// which makes "I changed the code but the browser shows the old
// thing" a daily occurrence. The PWA install + Lighthouse audit
// both happen on deployed builds anyway.
// ============================================================

import { useEffect } from 'react';

export function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Non-fatal — the site keeps working without the SW, just
          // without offline shell + Lighthouse PWA criteria. Visible
          // to operators via the browser devtools.
          console.warn('[sw] registration failed:', err);
        });
    };

    // window 'load' is the canonical hook for SW registration so
    // we don't compete with the first-paint network.
    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
