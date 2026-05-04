import { NextRequest, NextResponse } from 'next/server';
import {
  resolvePlayAction,
  type PlayActionRequestData,
} from '@/lib/game/playActionResolver';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function POST(req: NextRequest) {
  const limited = await checkRateLimit(req, { scope: 'default' });
  if (limited) return limited;

  try {
    const body = (await req.json()) as PlayActionRequestData;

    if (!body?.sceneId || !body?.sceneTitle || !body?.action?.type) {
      return NextResponse.json(
        { error: 'Missing required action fields.' },
        { status: 400 }
      );
    }

    const result = resolvePlayAction(body);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
