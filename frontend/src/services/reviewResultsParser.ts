/**
 * Service for parsing Claude Code review output into structured data.
 */

// ============================================================================
// Types
// ============================================================================

export type IssueSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export interface ReviewIssue {
  severity: IssueSeverity;
  category: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ReviewSummary {
  overall: string;
  strengths: string[];
  improvements: string[];
}

export interface ReviewResults {
  issues: ReviewIssue[];
  summary: ReviewSummary;
  explanatoryText?: string;
}

export class ReviewParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string
  ) {
    super(message);
    this.name = 'ReviewParseError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const VALID_SEVERITIES: readonly IssueSeverity[] = [
  'critical',
  'major',
  'minor',
  'suggestion',
];

const DEFAULT_SEVERITY: IssueSeverity = 'minor';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts JSON from Claude Code output, handling markdown code fences.
 * Returns the extracted JSON string and any explanatory text found.
 */
function extractJsonFromOutput(output: string): {
  jsonString: string;
  explanatoryText: string;
} {
  const trimmed = output.trim();

  // Pattern to match JSON in markdown code fences
  const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = fencedJsonPattern.exec(trimmed)) !== null) {
    matches.push(match[1].trim());
  }

  // If we found fenced JSON, use the first one that looks like valid JSON
  if (matches.length > 0) {
    for (const candidate of matches) {
      if (
        (candidate.startsWith('{') && candidate.endsWith('}')) ||
        (candidate.startsWith('[') && candidate.endsWith(']'))
      ) {
        // Extract text outside the code fence as explanatory text
        const explanatoryText = trimmed
          .replace(/```(?:json)?\s*[\s\S]*?```/g, '')
          .trim();
        return { jsonString: candidate, explanatoryText };
      }
    }
  }

  // No fenced JSON found, try to find raw JSON object/array
  // Look for the first { or [ and find its matching closing bracket
  const jsonStartIndex = findJsonStart(trimmed);
  if (jsonStartIndex !== -1) {
    const jsonEndIndex = findMatchingBracket(trimmed, jsonStartIndex);
    if (jsonEndIndex !== -1) {
      const jsonString = trimmed.slice(jsonStartIndex, jsonEndIndex + 1);
      const before = trimmed.slice(0, jsonStartIndex).trim();
      const after = trimmed.slice(jsonEndIndex + 1).trim();
      const explanatoryText = [before, after].filter(Boolean).join('\n\n');
      return { jsonString, explanatoryText };
    }
  }

  // Last resort: return the whole thing as JSON and empty explanatory text
  return { jsonString: trimmed, explanatoryText: '' };
}

/**
 * Finds the index of the first JSON start character ({ or [).
 */
function findJsonStart(text: string): number {
  const braceIndex = text.indexOf('{');
  const bracketIndex = text.indexOf('[');

  if (braceIndex === -1) return bracketIndex;
  if (bracketIndex === -1) return braceIndex;
  return Math.min(braceIndex, bracketIndex);
}

/**
 * Finds the index of the matching closing bracket for a JSON structure.
 */
function findMatchingBracket(text: string, startIndex: number): number {
  const openChar = text[startIndex];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
  }

  return -1;
}

/**
 * Validates and normalizes a severity value.
 */
function normalizeSeverity(severity: unknown): IssueSeverity {
  if (typeof severity !== 'string') {
    return DEFAULT_SEVERITY;
  }

  const lower = severity.toLowerCase() as IssueSeverity;
  if (VALID_SEVERITIES.includes(lower)) {
    return lower;
  }

  // Map common alternatives
  const severityMap: Record<string, IssueSeverity> = {
    error: 'critical',
    warning: 'major',
    warn: 'major',
    info: 'minor',
    hint: 'suggestion',
    nit: 'suggestion',
    nitpick: 'suggestion',
    high: 'critical',
    medium: 'major',
    low: 'minor',
  };

  return severityMap[lower] ?? DEFAULT_SEVERITY;
}

/**
 * Parses and validates a single issue object.
 */
function parseIssue(raw: unknown, index: number): ReviewIssue {
  if (typeof raw !== 'object' || raw === null) {
    throw new ReviewParseError(
      `Issue at index ${index} is not an object`
    );
  }

  const obj = raw as Record<string, unknown>;

  // Message is required
  const message = obj.message ?? obj.description ?? obj.text;
  if (typeof message !== 'string' || message.trim() === '') {
    throw new ReviewParseError(
      `Issue at index ${index} is missing a valid message`
    );
  }

  const issue: ReviewIssue = {
    severity: normalizeSeverity(obj.severity ?? obj.level ?? obj.priority),
    category: typeof obj.category === 'string' ? obj.category : 'general',
    message: message.trim(),
  };

  // Optional fields
  if (typeof obj.file === 'string' && obj.file.trim() !== '') {
    issue.file = obj.file.trim();
  } else if (typeof obj.path === 'string' && obj.path.trim() !== '') {
    issue.file = obj.path.trim();
  } else if (typeof obj.filename === 'string' && obj.filename.trim() !== '') {
    issue.file = obj.filename.trim();
  }

  if (typeof obj.line === 'number' && Number.isInteger(obj.line) && obj.line > 0) {
    issue.line = obj.line;
  } else if (typeof obj.lineNumber === 'number' && Number.isInteger(obj.lineNumber) && obj.lineNumber > 0) {
    issue.line = obj.lineNumber;
  } else if (typeof obj.line === 'string') {
    const parsed = parseInt(obj.line, 10);
    if (!isNaN(parsed) && parsed > 0) {
      issue.line = parsed;
    }
  }

  if (typeof obj.suggestion === 'string' && obj.suggestion.trim() !== '') {
    issue.suggestion = obj.suggestion.trim();
  } else if (typeof obj.fix === 'string' && obj.fix.trim() !== '') {
    issue.suggestion = obj.fix.trim();
  } else if (typeof obj.recommendation === 'string' && obj.recommendation.trim() !== '') {
    issue.suggestion = obj.recommendation.trim();
  }

  return issue;
}

/**
 * Parses an array of issues.
 */
function parseIssues(raw: unknown): ReviewIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const issues: ReviewIssue[] = [];
  for (let i = 0; i < raw.length; i++) {
    try {
      issues.push(parseIssue(raw[i], i));
    } catch {
      // Skip malformed issues but continue parsing others
      continue;
    }
  }

  return issues;
}

/**
 * Parses a string array, handling various input formats.
 */
function parseStringArray(raw: unknown): string[] {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  if (typeof raw === 'string') {
    // Handle newline-separated or comma-separated strings
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return [];
}

/**
 * Parses the summary section.
 */
function parseSummary(raw: unknown): ReviewSummary {
  const defaultSummary: ReviewSummary = {
    overall: '',
    strengths: [],
    improvements: [],
  };

  if (typeof raw !== 'object' || raw === null) {
    return defaultSummary;
  }

  const obj = raw as Record<string, unknown>;

  return {
    overall:
      typeof obj.overall === 'string'
        ? obj.overall.trim()
        : typeof obj.summary === 'string'
          ? obj.summary.trim()
          : typeof obj.description === 'string'
            ? obj.description.trim()
            : '',
    strengths: parseStringArray(obj.strengths ?? obj.pros ?? obj.positives),
    improvements: parseStringArray(
      obj.improvements ?? obj.cons ?? obj.negatives ?? obj.weaknesses
    ),
  };
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parses Claude Code review output into structured ReviewResults.
 *
 * @param claudeOutput - Raw output from Claude Code review
 * @returns Structured review results
 * @throws ReviewParseError if parsing fails completely
 *
 * @example
 * ```ts
 * const output = `
 * Here's my review:
 * \`\`\`json
 * {
 *   "issues": [{"severity": "major", "message": "Missing null check"}],
 *   "summary": {"overall": "Good code with some issues"}
 * }
 * \`\`\`
 * `;
 * const results = parseReviewOutput(output);
 * ```
 */
export function parseReviewOutput(claudeOutput: string): ReviewResults {
  if (typeof claudeOutput !== 'string') {
    throw new ReviewParseError(
      'Input must be a string',
      String(claudeOutput)
    );
  }

  const trimmed = claudeOutput.trim();
  if (trimmed === '') {
    throw new ReviewParseError('Input is empty');
  }

  // Extract JSON and explanatory text
  const { jsonString, explanatoryText } = extractJsonFromOutput(trimmed);

  // Attempt to parse the JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new ReviewParseError(
      `Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
      claudeOutput
    );
  }

  // Validate that we got an object
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ReviewParseError(
      'Parsed JSON is not an object',
      claudeOutput
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Build the result
  const result: ReviewResults = {
    issues: parseIssues(obj.issues ?? obj.problems ?? obj.findings ?? []),
    summary: parseSummary(obj.summary ?? obj.review ?? {}),
  };

  // Add explanatory text if present
  if (explanatoryText) {
    result.explanatoryText = explanatoryText;
  }

  return result;
}
