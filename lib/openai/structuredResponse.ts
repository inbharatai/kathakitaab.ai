const VALID_LABELS = new Set(['CANON', 'EXPLANATION', 'INTERPRETATION', 'CREATIVE']);

export interface StructuredAgentResponse {
  label: string;
  answer: string;
  source_note: string;
  next_options: string[];
  safety_note: string;
}

export interface StructuredAgentFallback {
  answer: string;
  source_note: string;
  next_options: string[];
  label?: string;
  safety_note?: string;
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractJsonBlock(value: string): string {
  const stripped = stripCodeFences(value);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');

  if (start === -1 || end <= start) {
    return stripped;
  }

  return stripped.slice(start, end + 1);
}

function escapeBareLineBreaksInStrings(value: string): string {
  let result = '';
  let inString = false;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString && (char === '\n' || char === '\r')) {
      result += char === '\n' ? '\\n' : '\\r';
      continue;
    }

    result += char;
  }

  return result;
}

function repairTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function uniqueCandidates(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function sliceFieldSegment(value: string, fieldName: string, nextFieldNames: string[]): string | undefined {
  const fieldMarker = `"${fieldName}"`;
  const keyIndex = value.indexOf(fieldMarker);
  if (keyIndex === -1) return undefined;

  const colonIndex = value.indexOf(':', keyIndex + fieldMarker.length);
  if (colonIndex === -1) return undefined;

  let start = colonIndex + 1;
  while (start < value.length && /\s/.test(value[start] ?? '')) {
    start += 1;
  }

  let end = value.length;
  for (const nextFieldName of nextFieldNames) {
    const nextIndex = value.indexOf(`"${nextFieldName}"`, start);
    if (nextIndex !== -1 && nextIndex < end) {
      end = nextIndex - 1;
    }
  }

  const segment = value.slice(start, end).trim().replace(/,$/, '').trim();
  return segment || undefined;
}

function normalizeStringSegment(segment: string | undefined): string | undefined {
  if (!segment) return undefined;

  if (segment.startsWith('"') && segment.endsWith('"')) {
    const parsed = tryParseJson<string>(escapeBareLineBreaksInStrings(segment));
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim();
    }
  }

  return segment.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').trim() || undefined;
}

function extractNextOptions(value: string): string[] | undefined {
  const segment = sliceFieldSegment(value, 'next_options', ['safety_note']);
  if (!segment) return undefined;

  const parsed = tryParseJson<unknown[]>(repairTrailingCommas(escapeBareLineBreaksInStrings(segment)));
  if (Array.isArray(parsed)) {
    const nextOptions = parsed
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

    if (nextOptions.length > 0) {
      return nextOptions;
    }
  }

  const matches = Array.from(segment.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g))
    .map(([, option]) => option.replace(/\\n/g, '\n').trim())
    .filter(Boolean);

  return matches.length > 0 ? matches : undefined;
}

function sanitizeResponse(
  value: Partial<StructuredAgentResponse>,
  fallback: StructuredAgentFallback
): StructuredAgentResponse {
  const nextOptions = Array.isArray(value.next_options)
    ? value.next_options.map(option => option.trim()).filter(Boolean)
    : fallback.next_options.map(option => option.trim()).filter(Boolean);

  const label = VALID_LABELS.has(value.label ?? '')
    ? value.label!
    : VALID_LABELS.has(fallback.label ?? '')
      ? fallback.label!
      : 'EXPLANATION';

  return {
    label,
    answer: typeof value.answer === 'string' && value.answer.trim()
      ? value.answer.trim()
      : fallback.answer,
    source_note: typeof value.source_note === 'string' && value.source_note.trim()
      ? value.source_note.trim()
      : fallback.source_note,
    next_options: nextOptions.length > 0 ? nextOptions.slice(0, 3) : fallback.next_options.slice(0, 3),
    safety_note: typeof value.safety_note === 'string' && value.safety_note.trim()
      ? value.safety_note.trim()
      : fallback.safety_note ?? 'Structured response recovery fallback.',
  };
}

export function parseStructuredAgentResponse(
  raw: string | undefined,
  fallback: StructuredAgentFallback
): StructuredAgentResponse {
  if (!raw?.trim()) {
    return sanitizeResponse({}, fallback);
  }

  const jsonBlock = extractJsonBlock(raw);
  const repairedBlock = repairTrailingCommas(escapeBareLineBreaksInStrings(jsonBlock));

  for (const candidate of uniqueCandidates([raw, stripCodeFences(raw), jsonBlock, repairedBlock])) {
    const parsed = tryParseJson<Partial<StructuredAgentResponse>>(candidate);
    if (parsed && typeof parsed === 'object') {
      return sanitizeResponse(parsed, fallback);
    }
  }

  return sanitizeResponse(
    {
      label: normalizeStringSegment(sliceFieldSegment(repairedBlock, 'label', ['answer'])),
      answer: normalizeStringSegment(sliceFieldSegment(repairedBlock, 'answer', ['source_note', 'next_options', 'safety_note'])),
      source_note: normalizeStringSegment(sliceFieldSegment(repairedBlock, 'source_note', ['next_options', 'safety_note'])),
      next_options: extractNextOptions(repairedBlock),
      safety_note: normalizeStringSegment(sliceFieldSegment(repairedBlock, 'safety_note', [])),
    },
    fallback
  );
}