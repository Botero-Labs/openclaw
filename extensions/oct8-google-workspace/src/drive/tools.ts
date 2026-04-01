import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { DriveClient, getDefaultExportMime, isGoogleWorkspaceFile } from "./client.js";
import {
  DriveDownloadFileSchema,
  DriveExportFileSchema,
  DriveGetFileSchema,
  DriveSearchFilesSchema,
  DriveUploadFileSchema,
} from "./schemas.js";

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; details: unknown };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], details: undefined };
}

function formatApiError(err: ApiError): ToolResult {
  const retryHint = err.retryAfter ? ` Retry after ${err.retryAfter}s.` : "";
  return errorResult(`Drive API error (${err.code}): ${err.message}${retryHint}`);
}

function resolveDriveEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  const services = getServicesForKind(config, "drive");
  for (const svc of services) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId))) {
      return svc;
    }
  }
  return undefined;
}

export function registerDriveTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  const driveServices = getServicesForKind(config, "drive");
  if (driveServices.length === 0) return;

  // --- drive_search_files ---
  api.registerTool((ctx) => ({
    name: "drive_search_files",
    label: "Search Drive files",
    description: "Search for files in Google Drive using query syntax",
    parameters: DriveSearchFilesSchema,
    async execute(
      _id: string,
      params: { query: string; pageSize?: number; pageToken?: string; orderBy?: string },
    ) {
      const resolved = resolveDriveEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No drive service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "drive",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "search_files",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new DriveClient(accessToken);
        const result = await client.searchFiles(params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) return formatApiError(err as ApiError);
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- drive_get_file ---
  api.registerTool((ctx) => ({
    name: "drive_get_file",
    label: "Get Drive file metadata",
    description: "Get metadata for a file in Google Drive",
    parameters: DriveGetFileSchema,
    async execute(_id: string, params: { fileId: string }) {
      const resolved = resolveDriveEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No drive service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "drive",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_file",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new DriveClient(accessToken);
        const result = await client.getFile(params.fileId);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) return formatApiError(err as ApiError);
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- drive_download_file ---
  api.registerTool((ctx) => ({
    name: "drive_download_file",
    label: "Download Drive file",
    description:
      "Download file content from Google Drive. For Google Docs/Sheets/Slides, use drive_export_file instead.",
    parameters: DriveDownloadFileSchema,
    async execute(_id: string, params: { fileId: string }) {
      const resolved = resolveDriveEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No drive service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "drive",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "download_file",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new DriveClient(accessToken);

        // Check if it's a Google Workspace file first
        const meta = await client.getFile(params.fileId);
        if (isGoogleWorkspaceFile(meta.mimeType)) {
          return errorResult(
            `File "${meta.name}" is a Google Workspace file (${meta.mimeType}). ` +
              "Use drive_export_file instead to export it to a downloadable format.",
          );
        }

        const content = await client.downloadFile(params.fileId);
        // Truncate large content for tool output
        const maxLen = 50_000;
        const truncated = content.length > maxLen;
        const output = truncated ? content.slice(0, maxLen) : content;
        const suffix = truncated
          ? `\n\n[Content truncated at ${maxLen} characters. Full file is ${content.length} characters.]`
          : "";
        return textResult(output + suffix);
      } catch (err) {
        if ((err as ApiError).code) return formatApiError(err as ApiError);
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- drive_upload_file ---
  api.registerTool((ctx) => ({
    name: "drive_upload_file",
    label: "Upload file to Drive",
    description: "Upload a text file to Google Drive",
    parameters: DriveUploadFileSchema,
    async execute(
      _id: string,
      params: {
        name: string;
        content: string;
        mimeType: string;
        parentId?: string;
        description?: string;
      },
    ) {
      const resolved = resolveDriveEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No drive service configured for this agent.");

      // Defense in depth for delegated_human
      if (resolved.entry.mode === "delegated_human") {
        return errorResult(
          'Action "upload_file" is blocked in delegated_human mode. Ask the Drive owner to upload the file.',
        );
      }

      const policy = checkPolicy({
        config,
        serviceKind: "drive",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "upload_file",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new DriveClient(accessToken);
        const result = await client.uploadFile(params);
        return textResult(
          JSON.stringify(
            { fileId: result.id, name: result.name, webViewLink: result.webViewLink },
            null,
            2,
          ),
        );
      } catch (err) {
        if ((err as ApiError).code) return formatApiError(err as ApiError);
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- drive_export_file ---
  api.registerTool((ctx) => ({
    name: "drive_export_file",
    label: "Export Google Workspace file",
    description:
      "Export a Google Docs/Sheets/Slides file to PDF, plain text, docx, xlsx, etc. Max 10 MB.",
    parameters: DriveExportFileSchema,
    async execute(_id: string, params: { fileId: string; exportMimeType?: string }) {
      const resolved = resolveDriveEntry(config, ctx.agentId);
      if (!resolved) return errorResult("No drive service configured for this agent.");
      const policy = checkPolicy({
        config,
        serviceKind: "drive",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "export_file",
      });
      if (!policy.allowed) return errorResult(policy.reason);
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new DriveClient(accessToken);

        // If no export MIME type specified, get file metadata to determine default
        let exportMime = params.exportMimeType;
        if (!exportMime) {
          const meta = await client.getFile(params.fileId);
          exportMime = getDefaultExportMime(meta.mimeType);
        }

        const content = await client.exportFile(params.fileId, exportMime);
        const maxLen = 50_000;
        const truncated = content.length > maxLen;
        const output = truncated ? content.slice(0, maxLen) : content;
        const suffix = truncated ? `\n\n[Content truncated at ${maxLen} characters.]` : "";
        return textResult(output + suffix);
      } catch (err) {
        if ((err as ApiError).code) return formatApiError(err as ApiError);
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
