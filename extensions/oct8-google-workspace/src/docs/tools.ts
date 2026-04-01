import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { DocsClient, extractDocumentText } from "./client.js";
import { DocsExportDocumentSchema, DocsReadDocumentSchema } from "./schemas.js";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; details: unknown };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}
function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: undefined };
}
function formatApiError(err: ApiError): ToolResult {
  return errorResult(`Docs API error (${err.code}): ${err.message}`);
}

function resolveDocsEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  for (const svc of getServicesForKind(config, "docs")) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId)))
      return svc;
  }
  return undefined;
}

export function registerDocsTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  if (getServicesForKind(config, "docs").length === 0) return;

  // Both docs tools are read-only — no mode gate needed

  api.registerTool((ctx) => ({
    name: "docs_read_document",
    label: "Read Google Doc",
    description: "Read a Google Doc and extract its text content",
    parameters: DocsReadDocumentSchema,
    async execute(_id: string, params: { documentId: string }) {
      const resolved = resolveDocsEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No docs service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "docs",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "read_document",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const doc = await new DocsClient(accessToken).readDocument(params.documentId);
        const text = extractDocumentText(doc);
        const maxLen = 50_000;
        const truncated = text.length > maxLen;
        const output = truncated ? text.slice(0, maxLen) : text;
        const suffix = truncated ? `\n\n[Content truncated at ${maxLen} characters.]` : "";
        return textResult(`# ${doc.title}\n\n${output}${suffix}`);
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "docs_export_document",
    label: "Export Google Doc",
    description: "Export a Google Doc to plain text, markdown, PDF, docx, HTML, or other formats",
    parameters: DocsExportDocumentSchema,
    async execute(_id: string, params: { documentId: string; exportMimeType?: string }) {
      const resolved = resolveDocsEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No docs service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "docs",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "export_document",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const mimeType = params.exportMimeType ?? "text/plain";
        const content = await new DocsClient(accessToken).exportDocument(
          params.documentId,
          mimeType,
        );
        const maxLen = 50_000;
        const truncated = content.length > maxLen;
        const output = truncated ? content.slice(0, maxLen) : content;
        const suffix = truncated ? `\n\n[Content truncated at ${maxLen} characters.]` : "";
        return textResult(output + suffix);
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
