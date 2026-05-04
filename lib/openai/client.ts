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
  return !!process.env.GEMINI_API_KEY;
}
