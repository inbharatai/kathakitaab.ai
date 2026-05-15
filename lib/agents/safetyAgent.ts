// ============================================================
// KathaKitaab — Safety Agent
//
// Validates generated content for age-appropriateness.
// Pure logic checks — no LLM calls for v1.
// ============================================================

import type { SafetyRating } from '@/lib/types/storyScene';

const BLOCKED_PATTERNS = [
  /\b(kill|murder|blood|gore|death\s+scene|torture|suicide)\b/i,
  /\b(sex|nude|naked|erotic|pornograph)\b/i,
  /\b(drug|cocaine|heroin|meth|weed)\b/i,
  /\b(hate\s+speech|racial\s+slur|bigot)\b/i,
  /\b(terrorist|bomb\s+making|weapon\s+of\s+mass)\b/i,
];

const TEEN_PATTERNS = [
  /\b(war\s+crime|bloody\s+battle|severed|decapitat)\b/i,
  /\b(alcohol|drinking|drunk|intoxicat)\b/i,
  /\b(gambling|betting)\b/i,
];

export interface SafetyResult {
  rating: SafetyRating;
  passed: boolean;
  issues: string[];
}

export function checkContentSafety(text: string): SafetyResult {
  const issues: string[] = [];

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Blocked content detected: ${pattern.source}`);
    }
  }

  if (issues.length > 0) {
    return { rating: 'blocked', passed: false, issues };
  }

  for (const pattern of TEEN_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Teen-only content detected: ${pattern.source}`);
    }
  }

  if (issues.length > 0) {
    return { rating: 'teen_safe', passed: true, issues };
  }

  return { rating: 'child_safe', passed: true, issues: [] };
}

export function checkImagePromptSafety(prompt: string): SafetyResult {
  return checkContentSafety(prompt);
}
