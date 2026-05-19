// ============================================================
// KathaKitaab — SceneStream Live Updates (SSE)
// GET /api/livebook/stream-updates/[sceneId]?bookSlug=ramayana
//
// A Server-Sent Events stream that emits `branch_ready` events as
// pre-generation lights up entries in the cache. The client uses
// these events to flip the action-menu dots from amber → green
// without re-fetching the manifest.
//
// Why polling-over-SSE rather than Redis pub/sub:
//   - On Vercel each function instance has its own Node heap, so
//     in-memory event emitters don't fan out across instances.
//   - Redis pub/sub would work but adds an infra dependency.
//   - The cache is already shared (Redis when configured, memory
//     otherwise), so polling it from the SSE handler is enough —
//     we just compare snapshots and emit deltas as events.
//
// The endpoint terminates as soon as every (entity × action) pair
// is warmed OR when the deadline elapses (60s default), whichever
// comes first. Clients should reconnect if they miss the close.
// ============================================================

import { getCachedBranch, getPregenActions } from '@/lib/engine/branchPreGenerator';
import { getCanonEntry } from '@/lib/data/canonLookup';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getScene, getBook } from '@/lib/data/bookRegistry';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook, resolveBookVisibility } from '@/lib/auth/bookAccess';

// SSE responses must stream — opt out of static optimization explicitly.
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 1500;
const DEADLINE_MS = 60_000;
const NAV_VERBS = new Set(['continue', 'next', 'back']);

interface ActionTuple {
  entityId: string;
  verb: string;
}

// ── Resolve verbs we expect to be warmed for this scene ──────
// Pulls from canon's allowed_actions if available, otherwise from
// the type defaults. Same logic as scene-stream/[sceneId]/route.ts
// so the SSE stream and the manifest stay coherent.
async function resolveActionTuples(bookSlug: string, sceneId: string): Promise<ActionTuple[]> {
  const hotspots = await getHotspotsForScene(bookSlug, sceneId);
  const out: ActionTuple[] = [];
  for (const h of hotspots) {
    const canon = getCanonEntry(bookSlug, h.targetId);
    const verbs = canon?.allowed_actions
      ? canon.allowed_actions.map(a => a.toLowerCase()).filter(a => !NAV_VERBS.has(a))
      : getPregenActions(bookSlug, h.targetId, h.type);
    for (const verb of verbs) {
      out.push({ entityId: h.targetId, verb });
    }
  }
  return out;
}

interface ResolvedHotspot { targetId: string; type: string }

async function getHotspotsForScene(bookSlug: string, sceneId: string): Promise<ResolvedHotspot[]> {
  const book = await getBook(bookSlug);
  const sceneSlug = book?.slug ?? bookSlug;
  if (sceneSlug === 'ramayana') {
    const scene = getSceneWithHotspots(sceneId);
    if (scene) {
      return scene.hotspots.map(h => ({ targetId: h.target_id, type: h.hotspot_type }));
    }
  }
  const generic = await getScene(sceneSlug, sceneId);
  if (!generic) return [];
  return (generic.hotspots ?? []).map(h => ({ targetId: h.target_id, type: h.hotspot_type }));
}

// ── Handler ──────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  const { sceneId } = await params;
  const url = new URL(request.url);
  const bookSlug = url.searchParams.get('bookSlug') ?? '';
  if (!bookSlug) {
    return new Response(JSON.stringify({ error: 'bookSlug query parameter is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Visibility check for AI-generated books.
  const session = await getSessionFromRouteRequest(request);
  const book = await getBook(bookSlug);
  if (book) {
    const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
    const isAdmin = isAdminSession(session);
    if (!isAdmin && !canReadBook(book, ownerId)) {
      return new Response(JSON.stringify({ error: 'Book not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const tuples = await resolveActionTuples(bookSlug, sceneId);
  const totalExpected = tuples.length;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const seen = new Set<string>();
      const deadline = Date.now() + DEADLINE_MS;
      let closed = false;

      // Detect client disconnect via the request's AbortSignal — if the
      // EventSource on the browser closes, the polling loop should bail
      // immediately instead of running for the full 60s deadline. Saves
      // ~40 cache reads on every closed tab.
      const abortHandler = () => { closed = true; };
      request.signal.addEventListener('abort', abortHandler);

      const emit = (event: string, data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Initial snapshot — emit `branch_ready` for anything already
      // warmed when the client connects, so a late subscriber doesn't
      // miss earlier completions.
      for (const tuple of tuples) {
        const branch = await getCachedBranch(sceneId, tuple.entityId, tuple.verb);
        if (branch && branch.status === 'ready') {
          seen.add(`${tuple.entityId}:${tuple.verb}`);
          emit('branch_ready', { entityId: tuple.entityId, verb: tuple.verb });
        }
      }
      emit('snapshot', { ready: seen.size, total: totalExpected });

      // Bail early if everything's already warm — no need to poll.
      if (seen.size >= totalExpected) {
        emit('complete', { ready: seen.size, total: totalExpected });
        controller.close();
        return;
      }

      // Polling loop — checks the cache for newly-warmed branches and
      // emits a `branch_ready` event for each one we haven't seen yet.
      while (!closed && Date.now() < deadline && seen.size < totalExpected) {
        await sleep(POLL_INTERVAL_MS);
        for (const tuple of tuples) {
          const key = `${tuple.entityId}:${tuple.verb}`;
          if (seen.has(key)) continue;
          const branch = await getCachedBranch(sceneId, tuple.entityId, tuple.verb);
          if (branch && branch.status === 'ready') {
            seen.add(key);
            emit('branch_ready', { entityId: tuple.entityId, verb: tuple.verb });
          }
        }
      }

      emit('complete', { ready: seen.size, total: totalExpected });
      request.signal.removeEventListener('abort', abortHandler);
      try { controller.close(); } catch { /* already closed by abort */ }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Vercel quirk: omitting this header lets the platform buffer
      // small SSE chunks, which delays event delivery. Disabling
      // compression here keeps events flowing in real time.
      'X-Accel-Buffering': 'no',
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
