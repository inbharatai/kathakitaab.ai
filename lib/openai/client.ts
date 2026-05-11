import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (geminiClient) return geminiClient;
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Please add it to your .env.local file.');
  }

  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

export function getTextModel(): string {
  return process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
}

export function isGeminiConfigured(): boolean {
  // Production directive: OpenAI + Sarvam only. Every agent that
  // checks isGeminiConfigured() reads this as "Gemini is off",
  // turning the per-agent Gemini fallback branches into dead code
  // in one place without rewriting 13 files. To re-enable for an
  // experiment or local dev, set KATHA_ENABLE_GEMINI=1 alongside
  // GEMINI_API_KEY — without that flag, even a valid key returns
  // false here.
  if (process.env.KATHA_ENABLE_GEMINI !== '1') return false;
  return !!process.env.GEMINI_API_KEY;
}
