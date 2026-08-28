export type JsonSchema = Record<string, unknown>;

export type WebMcpToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMcpExecuteOptions = {
  signal: AbortSignal;
};

export type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpToolAnnotations;
  execute: (input: unknown, options: WebMcpExecuteOptions) => unknown | Promise<unknown>;
};

export type WebMcpModelContext = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

export type WebMcpDocument = Document & {
  modelContext?: WebMcpModelContext;
};

export type WebMcpErrorCode =
  | 'NOT_READY'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'REVISION_CONFLICT'
  | 'COLLISION'
  | 'LOCKED'
  | 'VALIDATION_FAILED'
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'
  | 'NO_HISTORY'
  | 'CONFIRMATION_REQUIRED'
  | 'PREREQUISITE_REQUIRED'
  | 'GEOMETRY_CONFLICT'
  | 'OPENING_DOES_NOT_FIT'
  | 'EXTERIOR_LOOP_INVALID'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export type WebMcpSuccess<T = Record<string, unknown>> = {
  ok: true;
  message: string;
  projectId?: string;
  revision?: number;
  data?: T;
};

export type WebMcpFailure = {
  ok: false;
  code: WebMcpErrorCode;
  message: string;
  retryable: boolean;
  currentRevision?: number;
  data?: Record<string, unknown>;
};

export type WebMcpResult<T = Record<string, unknown>> = WebMcpSuccess<T> | WebMcpFailure;
