import type { WebMcpErrorCode, WebMcpFailure, WebMcpSuccess } from './types';

export const toolSuccess = <T = Record<string, unknown>>(
  message: string,
  options: { projectId?: string; revision?: number; data?: T } = {},
): WebMcpSuccess<T> => ({ ok: true, message, ...options });

export const toolFailure = (
  code: WebMcpErrorCode,
  message: string,
  options: { retryable?: boolean; currentRevision?: number; data?: Record<string, unknown> } = {},
): WebMcpFailure => ({
  ok: false,
  code,
  message,
  retryable: options.retryable ?? false,
  ...(options.currentRevision === undefined ? {} : { currentRevision: options.currentRevision }),
  ...(options.data === undefined ? {} : { data: options.data }),
});

export function toolFailureFromMessage(message: string, currentRevision?: number): WebMcpFailure {
  const normalized = message.toLowerCase();
  if (normalized.includes('still loading')) return toolFailure('NOT_READY', message, { retryable: true, currentRevision });
  if (normalized.includes('changed since') || normalized.includes('changed while')) return toolFailure('REVISION_CONFLICT', message, { retryable: true, currentRevision });
  if (normalized.includes('overlap')) return toolFailure('COLLISION', message, { retryable: true, currentRevision });
  if (normalized.includes('locked')) return toolFailure('LOCKED', message, { currentRevision });
  if (normalized.includes('finish target')) return toolFailure('TARGET_NOT_FOUND', message, { retryable: true, currentRevision });
  if (normalized.includes('not found') || normalized.includes('unavailable')) return toolFailure('NOT_FOUND', message, { currentRevision });
  if (normalized.includes('connection') || normalized.includes('network') || normalized.includes('fetch')) return toolFailure('NETWORK_ERROR', message, { retryable: true, currentRevision });
  if (normalized.includes('must') || normalized.includes('invalid') || normalized.includes('required')) return toolFailure('INVALID_INPUT', message, { currentRevision });
  return toolFailure('VALIDATION_FAILED', message, { currentRevision });
}

export const cancelledResult = () => toolFailure('CANCELLED', 'The WebMCP action was cancelled.', { retryable: true });
