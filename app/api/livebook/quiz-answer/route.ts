import { NextResponse } from 'next/server';
import { QuizAnswerRequest } from '@/lib/types/livebook';
import { getQuizzesBySceneId } from '@/lib/data/ramayanaSeed';
import { getScene as getRegistryScene, getBook } from '@/lib/data/bookRegistry';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook } from '@/lib/auth/bookAccess';

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: QuizAnswerRequest = await request.json();
    const { quizId, sceneId, selectedAnswer, bookSlug } = body;

    // Auth gate: only Ramayana quizzes for anonymous users.
    const session = await getSessionFromRouteRequest(request);
    if (!session && bookSlug && bookSlug !== 'ramayana') {
      return NextResponse.json({ error: 'Sign in to answer quizzes for this book.', reason: 'auth_required' }, { status: 401 });
    }

    // Visibility check for AI-generated books.
    if (bookSlug && bookSlug !== 'ramayana') {
      const book = await getBook(bookSlug);
      if (book) {
        const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
        const isAdmin = isAdminSession(session);
        if (!isAdmin && !canReadBook(book, ownerId)) {
          return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }
      }
    }

    // Universal quiz lookup: Ramayana seed first, then bookRegistry
    // (each AI-generated scene carries its own quiz_questions[]).
    let quiz: { correct_answer: number; explanation: string } | undefined;
    const seedQuizzes = getQuizzesBySceneId(sceneId);
    quiz = seedQuizzes.find(q => q.id === quizId);
    if (!quiz && bookSlug) {
      const scene = await getRegistryScene(bookSlug, sceneId);
      quiz = scene?.quiz_questions.find(q => q.id === quizId);
    }

    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }

    const correct = selectedAnswer === quiz.correct_answer;

    return NextResponse.json({
      correct,
      correctAnswer: quiz.correct_answer,
      explanation: quiz.explanation,
    });
  } catch (error: unknown) {
    console.error('Quiz answer error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
