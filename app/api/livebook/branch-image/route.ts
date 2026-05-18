// ============================================================
// KathaKitaab — Branch Image Poll Endpoint
// GET /api/livebook/branch-image?branchId=...
//
// entity-interact returns narration immediately and kicks image
// generation off in the background. The client polls this endpoint
// to swap the image in when it's ready.
// ============================================================

import { NextResponse } from 'next/server';
import { getBranchImageJob } from '@/lib/engine/branchImageJobs';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  const url = new URL(request.url);
  const branchId = url.searchParams.get('branchId');
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 });

  const job = await getBranchImageJob(branchId);
  if (!job) return NextResponse.json({ status: 'unknown' }, { status: 404 });

  if (job.state === 'ready') {
    return NextResponse.json({ status: 'ready', imageUrl: job.imageUrl });
  }
  if (job.state === 'failed') {
    return NextResponse.json({ status: 'failed', error: job.error });
  }
  return NextResponse.json({ status: 'pending' });
}
