import { NextResponse } from 'next/server';
import { deleteJob, getJob } from '@/lib/data/jobRegistry';
import { deleteScenesForBook } from '@/lib/data/sceneRegistry';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';

/** Admin-only deletion of a generation job and its associated scenes.
 *
 *  DELETE /api/admin/jobs/{id}
 *  Returns 403 for non-admin users.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  // Look up the job so we can also clean up its scenes.
  const job = await getJob(id);
  if (job?.slug) {
    await deleteScenesForBook(job.slug);
  }

  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
