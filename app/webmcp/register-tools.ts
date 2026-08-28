import { cancelledResult, toolFailure } from './result';
import type { WebMcpDocument, WebMcpResult, WebMcpTool } from './types';

export type WebMcpTelemetryDetail = {
  event: 'registration_supported' | 'registration_unsupported' | 'registration_rejected' | 'tool_registered' | 'tool_started' | 'tool_succeeded' | 'tool_failed' | 'tool_cancelled';
  tool?: string;
  code?: string;
  durationMs?: number;
  revision?: number;
};

export const webMcpEnabled = process.env.NEXT_PUBLIC_WEBMCP_ENABLED !== 'false';

export function getModelContext(target: Document = document) {
  return (target as WebMcpDocument).modelContext;
}

export function emitWebMcpTelemetry(detail: WebMcpTelemetryDetail) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WebMcpTelemetryDetail>('dwellwise:webmcp', { detail }));
}

const isResult = (value: unknown): value is WebMcpResult => Boolean(value && typeof value === 'object' && 'ok' in value);

export function executableTool(tool: WebMcpTool, resolveCurrent: (name: string) => WebMcpTool | undefined): WebMcpTool {
  return {
    ...tool,
    execute: async (input, options) => {
      const signal = options?.signal ?? new AbortController().signal;
      const started = performance.now();
      emitWebMcpTelemetry({ event: 'tool_started', tool: tool.name });
      if (signal.aborted) return cancelledResult();
      try {
        const current = resolveCurrent(tool.name);
        if (!current) return toolFailure('NOT_READY', 'This Dwellwise capability is no longer available on the active page.', { retryable: true });
        const result = await current.execute(input, { signal });
        const durationMs = Math.round(performance.now() - started);
        if (signal.aborted) {
          emitWebMcpTelemetry({ event: 'tool_cancelled', tool: tool.name, durationMs });
          return cancelledResult();
        }
        if (isResult(result) && !result.ok) {
          emitWebMcpTelemetry({ event: 'tool_failed', tool: tool.name, code: result.code, durationMs, revision: result.currentRevision });
        } else {
          emitWebMcpTelemetry({ event: 'tool_succeeded', tool: tool.name, durationMs, revision: isResult(result) && result.ok ? result.revision : undefined });
        }
        return result;
      } catch (error) {
        const durationMs = Math.round(performance.now() - started);
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          emitWebMcpTelemetry({ event: 'tool_cancelled', tool: tool.name, durationMs });
          return cancelledResult();
        }
        emitWebMcpTelemetry({ event: 'tool_failed', tool: tool.name, code: 'INTERNAL_ERROR', durationMs });
        return toolFailure('INTERNAL_ERROR', 'Dwellwise could not complete this WebMCP action.', { retryable: true });
      }
    },
  };
}
