import { NextResponse, after } from 'next/server';
import {
  getJobBySlug,
  updateJob,
  completeJob,
  failJob,
  type GenerationStep,
} from '@/lib/data/jobRegistry';
import {
  getScenesByBookSlug,
  assembleBookFromScenes,
  updateScene,
  getBookCharacters,
} from '@/lib/data/sceneRegistry';
import { getBook, saveGeneratedBook, setProgress } from '@/lib/data/bookRegistry';
import { hydrateBookAudio } from '@/lib/video/manifestSynthesizer';
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { generateBook } from '@/lib/openai/bookGeneratorAgent';
import { worldOutlinePrompt } from '@/lib/openai/modePrompts';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { scrubError } from '@/lib/safety/scrub';
import { captureException } from '@/lib/observability/sentry';
import { capture as trackEvent } from '@/lib/observability/analytics';
import type { StylePreset } from '@/lib/types/style';

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  const isAdmin = isAdminSession(session);

  if (!isAdmin) {
    const limited = await checkRateLimit(request, { scope: 'default' });
    if (limited) return limited;
  }

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not set. The book generator is OpenAI-only.' },
      { status: 503 },
    );
  }

  let body: { slug: string };
  try {
    body = (await request.json()) as { slug: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  const job = await getJobBySlug(slug);
  if (!job) {
    return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });
  }

  if (!job.resumable) {
    return NextResponse.json(
      { error: 'This generation cannot be resumed' },
      { status: 400 },
    );
  }

  // Ownership check
  const ownerId = getOwnerIdFromRequest(request);
  const callerId = session?.userId ?? ownerId;
  if (!isAdmin && job.userId !== callerId) {
    return NextResponse.json(
      { error: 'Not authorized to resume this generation' },
      { status: 403 },
    );
  }

  // Lock the job so concurrent resume requests don't double-run.
  await updateJob(job.id, { status: 'queued', currentStep: null });
  await setProgress(slug, 'Resuming...', 0);

  after(async () => {
    let runningStep: GenerationStep = job.failedStep ?? 'outline';

    try {
      const earlyFailure =
        job.status === 'failed' &&
        (job.failedStep === 'outline' ||
          job.failedStep === 'portraits' ||
          job.failedStep === 'scene_details');

      if (earlyFailure) {
        runningStep = 'outline';
        // Early failure: re-run the full pipeline from scratch.
        const outlinePrompt =
          (job.metadata?.outlinePrompt as string) || worldOutlinePrompt(job.title);
        const book = await generateBook(
          job.title,
          (step, percent) => {
            void setProgress(slug, step, percent).catch(() => {});
          },
          {
            outlinePrompt,
            stylePreset: job.stylePreset as StylePreset | undefined,
          },
        );

        const finalBook = {
          ...book,
          slug,
          mode: job.mode,
          ownerId: job.userId ?? undefined,
          visibility: (job.mode === 'world' ? 'public' : 'private') as 'public' | 'private',
          metadata: job.metadata,
          stylePreset: job.stylePreset as StylePreset | undefined,
          updatedAt: Date.now(),
        };
        await saveGeneratedBook(finalBook);
        try {
          const hydrated = await hydrateBookAudio(finalBook);
          await saveGeneratedBook(hydrated);
        } catch {
          // TTS failure is non-fatal — reader falls back to lazy TTS.
        }
        await completeJob(job.id, slug);
      } else if (
        (job.status === 'failed' && job.failedStep === 'scene_images') ||
        job.status === 'images_partial'
      ) {
        runningStep = 'scene_images';
        // Image failure: regenerate only the missing / failed images.
        await updateJob(job.id, {
          status: 'images_generating',
          currentStep: 'scene_images',
        });
        const scenes = await getScenesByBookSlug(slug);
        const characters = (await getBookCharacters(slug)) ?? [];

        for (const scene of scenes) {
          if (scene.imageStatus === 'completed') continue;
          try {
            const imageResult = await generateSceneImage(scene.visual_description, {
              bookSlug: slug,
              characters: scene.characters_present ?? [],
              forbiddenCharacters: scene.characters_absent ?? [],
              mood: scene.mood ?? 'serene',
              stylePreset: job.stylePreset as StylePreset | undefined,
            });
            await updateScene(slug, scene.scene_id, {
              background_asset_url: imageResult.imageUrl,
              imageStatus: 'completed',
            });
          } catch (err) {
            console.warn(
              `[resume] image failed for ${scene.scene_id}:`,
              err instanceof Error ? err.message : err,
            );
            await updateScene(slug, scene.scene_id, { imageStatus: 'failed' });
          }
        }

        // Assemble the book from persisted scenes and save it.
        const staticCanonSlugs = new Set(['ramayana', 'mahabharata', 'panchatantra']);
        const book = await assembleBookFromScenes(slug, {
          id: `book-${slug}`,
          slug,
          title: job.title,
          subtitle:
            (job.metadata?.outlineSubtitle as string) ||
            `An interactive journey through ${job.title}`,
          description:
            (job.metadata?.outlineDescription as string) ||
            `Explore ${job.title} as a living storybook.`,
          source_tradition:
            (job.metadata?.outlineSourceTradition as string) ||
            'Public domain traditions',
          characters,
          generatedAt: Date.now(),
          accuracyLabel: staticCanonSlugs.has(slug)
            ? 'CANONICAL'
            : 'CREATIVE_RETELLING',
          mode: job.mode,
          ownerId: job.userId ?? undefined,
          visibility: job.mode === 'world' ? 'public' : 'private',
          metadata: job.metadata,
          stylePreset: job.stylePreset as StylePreset | undefined,
        });
        if (book) {
          await saveGeneratedBook(book);
          try {
            const hydrated = await hydrateBookAudio(book);
            await saveGeneratedBook(hydrated);
          } catch {
            // Non-fatal — reader falls back.
          }
        }
        await completeJob(job.id, slug);
      } else if (
        (job.status === 'failed' && job.failedStep === 'scene_tts') ||
        job.status === 'tts_partial'
      ) {
        runningStep = 'scene_tts';
        // TTS failure: book exists with images, just re-hydrate audio.
        const book = await getBook(slug);
        if (book) {
          await updateJob(job.id, {
            status: 'tts_generating',
            currentStep: 'scene_tts',
          });
          const hydrated = await hydrateBookAudio(book);
          await saveGeneratedBook(hydrated);
        }
        await completeJob(job.id, slug);
      } else if (job.status === 'failed' && job.failedStep === 'stitch') {
        runningStep = 'stitch';
        // Stitch failure: assemble from scenes and save.
        const characters = (await getBookCharacters(slug)) ?? [];
        const staticCanonSlugs = new Set(['ramayana', 'mahabharata', 'panchatantra']);
        const book = await assembleBookFromScenes(slug, {
          id: `book-${slug}`,
          slug,
          title: job.title,
          subtitle:
            (job.metadata?.outlineSubtitle as string) ||
            `An interactive journey through ${job.title}`,
          description:
            (job.metadata?.outlineDescription as string) ||
            `Explore ${job.title} as a living storybook.`,
          source_tradition:
            (job.metadata?.outlineSourceTradition as string) ||
            'Public domain traditions',
          characters,
          generatedAt: Date.now(),
          accuracyLabel: staticCanonSlugs.has(slug)
            ? 'CANONICAL'
            : 'CREATIVE_RETELLING',
          mode: job.mode,
          ownerId: job.userId ?? undefined,
          visibility: job.mode === 'world' ? 'public' : 'private',
          metadata: job.metadata,
          stylePreset: job.stylePreset as StylePreset | undefined,
        });
        if (book) {
          await saveGeneratedBook(book);
        }
        await completeJob(job.id, slug);
      } else {
        // Unknown / unexpected state — if the book already exists,
        // just mark the job completed.
        const book = await getBook(slug);
        if (book) {
          await completeJob(job.id, slug);
        } else {
          throw new Error('Unable to determine resume path');
        }
      }

      await setProgress(slug, 'Complete!', 100, true);
      void trackEvent({
        event: 'book_resumed',
        distinctId: session?.userId ?? ownerId ?? slug,
        properties: { slug, mode: job.mode, stylePreset: job.stylePreset },
      });
    } catch (err: unknown) {
      const safe = scrubError(err);
      console.error('[resume] failed for', slug, ':', safe.message);
      const userMsg = err instanceof Error ? err.message : 'Resume failed';
      await failJob(job.id, runningStep, userMsg);
      await setProgress(slug, 'Error', 0, true, userMsg);
      captureException(err, {
        tags: { route: 'books_resume', mode: job.mode || 'world' },
        extra: { slug },
      });
      void trackEvent({
        event: 'book_resume_failed',
        distinctId: session?.userId ?? ownerId ?? slug,
        properties: {
          slug,
          mode: job.mode,
          stylePreset: job.stylePreset,
          error: safe.message,
        },
      });
    }
  });

  return NextResponse.json({
    generating: true,
    slug,
    message: 'Resuming generation...',
  });
}
