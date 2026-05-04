import { NextResponse } from 'next/server';
import { QuizAnswerRequest } from '@/lib/types/livebook';
import { getQuizzesBySceneId } from '@/lib/data/ramayanaSeed';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function POST(request: Request) {
  const limited = checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: QuizAnswerRequest = await request.json();
    const { quizId, sceneId, selectedAnswer } = body;

    const quizzes = getQuizzesBySceneId(sceneId);
    const quiz = quizzes.find(q => q.id === quizId);

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
