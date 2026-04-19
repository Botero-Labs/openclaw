import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { SheetsClient } from "./client.js";
import {
  SheetsAppendRowsSchema,
  SheetsClearRangeSchema,
  SheetsGetMetadataSchema,
  SheetsReadRangeSchema,
  SheetsWriteRangeSchema,
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
  return errorResult(`Sheets API error (${err.code}): ${err.message}`);
}

function resolveSheetsEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  for (const svc of getServicesForKind(config, "sheets")) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId))) {
      return svc;
    }
  }
  return undefined;
}

export function registerSheetsTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  if (getServicesForKind(config, "sheets").length === 0) {
    return;
  }

  api.registerTool((ctx) => ({
    name: "sheets_get_metadata",
    label: "Get spreadsheet metadata",
    description: "Get spreadsheet title, sheet names, and properties",
    parameters: SheetsGetMetadataSchema,
    async execute(_id: string, params: { spreadsheetId: string }) {
      const resolved = resolveSheetsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No sheets service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "sheets",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_metadata",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const result = await new SheetsClient(accessToken).getMetadata(params.spreadsheetId);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "sheets_read_range",
    label: "Read spreadsheet range",
    description: "Read values from a spreadsheet range (A1 notation)",
    parameters: SheetsReadRangeSchema,
    async execute(_id: string, params: { spreadsheetId: string; range: string }) {
      const resolved = resolveSheetsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No sheets service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "sheets",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "read_range",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const result = await new SheetsClient(accessToken).readRange(
          params.spreadsheetId,
          params.range,
        );
        // Truncate large responses to prevent unbounded memory usage
        const maxRows = 1000;
        if (result.values && result.values.length > maxRows) {
          result.values = result.values.slice(0, maxRows);
          const text = JSON.stringify(result, null, 2);
          return textResult(
            text + `\n\n[Truncated to ${maxRows} rows. Use a narrower range for full data.]`,
          );
        }
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "sheets_write_range",
    label: "Write to spreadsheet",
    description: "Write values to a spreadsheet range",
    parameters: SheetsWriteRangeSchema,
    async execute(
      _id: string,
      params: { spreadsheetId: string; range: string; values: unknown[][] },
    ) {
      const resolved = resolveSheetsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No sheets service configured for this agent.");
      }
      if (resolved.entry.mode === "delegated_human") {
        return errorResult('"write_range" is blocked in delegated_human mode.');
      }
      const policy = checkPolicy({
        config,
        serviceKind: "sheets",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "write_range",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const result = await new SheetsClient(accessToken).writeRange(
          params.spreadsheetId,
          params.range,
          params.values,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "sheets_append_rows",
    label: "Append rows to spreadsheet",
    description: "Append rows after existing data in a spreadsheet range",
    parameters: SheetsAppendRowsSchema,
    async execute(
      _id: string,
      params: { spreadsheetId: string; range: string; values: unknown[][] },
    ) {
      const resolved = resolveSheetsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No sheets service configured for this agent.");
      }
      if (resolved.entry.mode === "delegated_human") {
        return errorResult('"append_rows" is blocked in delegated_human mode.');
      }
      const policy = checkPolicy({
        config,
        serviceKind: "sheets",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "append_rows",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const result = await new SheetsClient(accessToken).appendRows(
          params.spreadsheetId,
          params.range,
          params.values,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "sheets_clear_range",
    label: "Clear spreadsheet range",
    description: "Clear all values in a spreadsheet range",
    parameters: SheetsClearRangeSchema,
    async execute(_id: string, params: { spreadsheetId: string; range: string }) {
      const resolved = resolveSheetsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No sheets service configured for this agent.");
      }
      if (resolved.entry.mode === "delegated_human") {
        return errorResult('"clear_range" is blocked in delegated_human mode.');
      }
      const policy = checkPolicy({
        config,
        serviceKind: "sheets",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "clear_range",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const result = await new SheetsClient(accessToken).clearRange(
          params.spreadsheetId,
          params.range,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return (err as ApiError).code
          ? formatApiError(err as ApiError)
          : errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
