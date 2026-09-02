interface WebMcpToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface WebMcpExecutionOptions {
  signal: AbortSignal;
}

interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: WebMcpToolAnnotations;
  execute: (
    input: unknown,
    options?: WebMcpExecutionOptions
  ) => unknown | Promise<unknown>;
}

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] }
  ): Promise<void>;
}

interface Document {
  readonly modelContext?: WebMcpModelContext;
}
