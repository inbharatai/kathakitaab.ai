import { NextResponse } from 'next/server';
import { listUserJobs } from '@/lib/data/jobRegistry';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';

/** List all generation jobs for the current user (authenticated or
 *  anonymous). Returns an empty array when no user identity can be
 *  established. */
export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  const ownerId = getOwnerIdFromRequest(request);
  const userId = session?.userId ?? ownerId;

  if (!userId) {
    return NextResponse.json({ jobs: [] });
  }

  const jobs = await listUserJobs(userId);
  return NextResponse.json({ jobs });
}
