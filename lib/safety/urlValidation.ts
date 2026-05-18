/** Returns true when the URL is safe for server-side fetching.
 *  Blocks non-HTTP(S) protocols, localhost, and private IP ranges
 *  to prevent SSRF attacks. */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return false;
    if (host.startsWith('172.')) {
      const second = parseInt(host.split('.')[1], 10);
      if (second >= 16 && second <= 31) return false;
    }
    if (host.startsWith('169.254.')) return false; // link-local
    return true;
  } catch {
    return false;
  }
}
