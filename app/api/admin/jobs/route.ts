import { NextResponse } from 'next/server';
import { listAllJobs } from '@/lib/data/jobRegistry';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';

/** Admin-only listing of every generation job in the system.
 *
 *  Returns 403 for non-admin users.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const jobs = await listAllJobs();
  return NextResponse.json({ jobs });
}
