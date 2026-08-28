import { toolFailure } from './result';
import type { WebMcpFailure } from './types';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const MAX_CURSOR_LENGTH = 512;

type CursorPayload = {
  version: 1;
  scope: string;
  offset: number;
  consistency: string;
  query: string;
};

type PageInput = {
  limit?: unknown;
  cursor?: unknown;
};

export type ParsedPage = {
  limit: number;
  offset: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const pageInputSchemaProperties = {
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT, description: `Maximum results to return. Defaults to ${DEFAULT_PAGE_LIMIT}.` },
  cursor: { type: 'string', minLength: 1, maxLength: MAX_CURSOR_LENGTH, description: 'Opaque cursor returned by the previous page.' },
} as const;

export function consistencyFingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function encodeCursor(payload: CursorPayload) {
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeCursor(value: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (!isRecord(parsed)
      || parsed.version !== 1
      || typeof parsed.scope !== 'string'
      || !Number.isInteger(parsed.offset)
      || Number(parsed.offset) < 0
      || typeof parsed.consistency !== 'string'
      || typeof parsed.query !== 'string') return null;
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

export function parsePageInput(
  input: PageInput,
  options: { scope: string; consistency: string; query?: string },
): ParsedPage | WebMcpFailure {
  const limit = input.limit === undefined ? DEFAULT_PAGE_LIMIT : input.limit;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_PAGE_LIMIT) {
    return toolFailure('INVALID_INPUT', `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`);
  }
  if (input.cursor === undefined) return { limit: Number(limit), offset: 0 };
  if (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > MAX_CURSOR_LENGTH) {
    return toolFailure('INVALID_INPUT', 'cursor must be a non-empty cursor returned by the previous page.');
  }
  const cursor = decodeCursor(input.cursor);
  if (!cursor || cursor.scope !== options.scope || cursor.query !== (options.query ?? '')) {
    return toolFailure('INVALID_INPUT', 'cursor does not belong to this list request.');
  }
  if (cursor.consistency !== options.consistency) {
    return toolFailure('REVISION_CONFLICT', 'The list changed between pages. Restart pagination without a cursor.', { retryable: true });
  }
  return { limit: Number(limit), offset: cursor.offset };
}

export function paginate<T>(
  values: T[],
  page: ParsedPage,
  options: { scope: string; consistency: string; query?: string },
) {
  const items = values.slice(page.offset, page.offset + page.limit);
  const nextOffset = page.offset + items.length;
  return {
    items,
    ...(nextOffset < values.length ? {
      nextCursor: encodeCursor({
        version: 1,
        scope: options.scope,
        offset: nextOffset,
        consistency: options.consistency,
        query: options.query ?? '',
      }),
    } : {}),
  };
}
