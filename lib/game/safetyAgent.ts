import type { AgeBand } from '@/lib/game/playSessionState';

export interface SafetyEvaluation {
  blocked: boolean;
  message?: string;
}

const YOUTH_UNSAFE_PATTERN = /\b(kill|murder|blood|gore|sex|sexual|nude|suicide|self-harm|rape|torture|hate)\b/i;
const CHILD_UNSAFE_PATTERN = /\b(kill|fight|blood|weapon|scary|monster|death|sex|sexual|hate)\b/i;

export function evaluateActionSafety(
  actionLabel: string,
  userInput: string | undefined,
  ageBand: AgeBand
): SafetyEvaluation {
  const combined = `${actionLabel} ${userInput ?? ''}`.trim();

  const isUnsafe = ageBand === 'child'
    ? CHILD_UNSAFE_PATTERN.test(combined)
    : ageBand === 'youth'
      ? YOUTH_UNSAFE_PATTERN.test(combined)
      : false;

  if (!isUnsafe) {
    return { blocked: false };
  }

  return {
    blocked: true,
    message: 'The Story Master redirects the moment into a safer path and asks you to choose a kinder, wiser action.',
  };
}