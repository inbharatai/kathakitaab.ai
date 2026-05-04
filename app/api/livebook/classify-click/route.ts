// ============================================================
// KathaKitaab.ai — Click Classification API
// POST /api/livebook/classify-click
//
// Classifies what the user clicked on in a scene image.
// Used by the click-anywhere system when no hotspot exists.
// ============================================================

import { NextResponse } from 'next/server';
import { classifyImageClick } from '@/lib/engine/clickClassifier';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

interface ClassifyRequest {
  sceneTitle: string;
  sceneNarration: string;
  characters: string[];
  imageUrl: string | null;
  xPercent: number;
  yPercent: number;
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: ClassifyRequest = await request.json();
    const result = await classifyImageClick(
      body.sceneTitle,
      body.sceneNarration,
      body.characters,
      body.imageUrl,
      body.xPercent,
      body.yPercent,
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Classification failed';
    return NextResponse.json({ meaningful: false, entityType: 'unknown', label: 'Unknown', confidence: 0, reason: msg, suggestedAction: 'ignore' });
  }
}
