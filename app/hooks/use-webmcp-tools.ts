'use client';

import { useEffect, useRef } from 'react';
import { emitWebMcpTelemetry, executableTool, getModelContext, webMcpEnabled } from '@/app/webmcp/register-tools';
import type { WebMcpTool } from '@/app/webmcp/types';

export function useWebMcpTools(tools: WebMcpTool[], ready = true) {
  const currentTools = useRef(tools);
  const names = tools.map((tool) => tool.name).join('\u0000');

  useEffect(() => {
    currentTools.current = tools;
  });

  useEffect(() => {
    if (!ready || !webMcpEnabled || !names) return;
    const modelContext = getModelContext();
    if (!modelContext) {
      emitWebMcpTelemetry({ event: 'registration_unsupported' });
      return;
    }

    emitWebMcpTelemetry({ event: 'registration_supported' });
    const controller = new AbortController();
    const resolveCurrent = (name: string) => currentTools.current.find((tool) => tool.name === name);
    for (const definition of currentTools.current) {
      const tool = executableTool(definition, resolveCurrent);
      void modelContext.registerTool(tool, { signal: controller.signal })
        .then(() => {
          if (!controller.signal.aborted) emitWebMcpTelemetry({ event: 'tool_registered', tool: tool.name });
        })
        .catch(() => {
          if (!controller.signal.aborted) emitWebMcpTelemetry({ event: 'registration_rejected', tool: tool.name });
        });
    }

    return () => controller.abort();
  }, [names, ready]);
}
