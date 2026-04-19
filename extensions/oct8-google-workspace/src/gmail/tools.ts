import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { GmailClient } from "./client.js";
import { buildMimeMessage } from "./mime.js";
import {
  GmailCreateDraftSchema,
  GmailGetMessageSchema,
  GmailGetThreadSchema,
  GmailListLabelsSchema,
  GmailSearchMessagesSchema,
  GmailSearchThreadsSchema,
  GmailSendSchema,
  GmailUpdateDraftSchema,
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
  return errorResult(`Gmail API error (${err.code}): ${err.message}${retryHint}`);
}

function resolveMailEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  const mailServices = getServicesForKind(config, "mail");
  for (const svc of mailServices) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId))) {
      return svc;
    }
  }
  return undefined;
}

export function registerGmailTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  const mailServices = getServicesForKind(config, "mail");
  if (mailServices.length === 0) {
    return;
  }

  api.registerTool((ctx) => ({
    name: "gmail_search_threads",
    label: "Search Gmail threads",
    description: "Search Gmail threads by query",
    parameters: GmailSearchThreadsSchema,
    async execute(_id: string, params: { query: string; maxResults?: number; pageToken?: string }) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "search_threads",
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
        const client = new GmailClient(accessToken);
        const result = await client.searchThreads(
          params.query,
          params.maxResults,
          params.pageToken,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_search_messages",
    label: "Search Gmail messages",
    description: "Search individual Gmail messages by query",
    parameters: GmailSearchMessagesSchema,
    async execute(_id: string, params: { query: string; maxResults?: number; pageToken?: string }) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "search_messages",
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
        const client = new GmailClient(accessToken);
        const result = await client.searchMessages(
          params.query,
          params.maxResults,
          params.pageToken,
        );
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_get_thread",
    label: "Get Gmail thread",
    description: "Fetch a full Gmail thread with all messages",
    parameters: GmailGetThreadSchema,
    async execute(_id: string, params: { threadId: string; format?: string }) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_thread",
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
        const client = new GmailClient(accessToken);
        const result = await client.getThread(params.threadId, params.format);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_get_message",
    label: "Get Gmail message",
    description: "Fetch a single Gmail message by ID",
    parameters: GmailGetMessageSchema,
    async execute(_id: string, params: { messageId: string; format?: string }) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_message",
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
        const client = new GmailClient(accessToken);
        const result = await client.getMessage(params.messageId, params.format);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_create_draft",
    label: "Create Gmail draft",
    description: "Create a new Gmail draft (standalone or reply)",
    parameters: GmailCreateDraftSchema,
    async execute(
      _id: string,
      params: {
        to: string;
        subject: string;
        body: string;
        htmlBody?: string;
        cc?: string;
        bcc?: string;
        inReplyTo?: string;
        references?: string;
      },
    ) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "create_draft",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken, email } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const raw = buildMimeMessage({ from: email, ...params });
        const client = new GmailClient(accessToken);
        const result = await client.createDraft(raw);
        return textResult(
          JSON.stringify({ draftId: result.id, messageId: result.message?.id }, null, 2),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_update_draft",
    label: "Update Gmail draft",
    description: "Replace the content of an existing Gmail draft",
    parameters: GmailUpdateDraftSchema,
    async execute(
      _id: string,
      params: {
        draftId: string;
        to: string;
        subject: string;
        body: string;
        htmlBody?: string;
        cc?: string;
        bcc?: string;
      },
    ) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "update_draft",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }
      try {
        const { accessToken, email } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const { draftId, ...mimeParams } = params;
        const raw = buildMimeMessage({ from: email, ...mimeParams });
        const client = new GmailClient(accessToken);
        const result = await client.updateDraft(draftId, raw);
        return textResult(JSON.stringify({ draftId: result.id }, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_send",
    label: "Send Gmail",
    description: "Send a Gmail draft or compose-and-send a new email",
    parameters: GmailSendSchema,
    async execute(
      _id: string,
      params: {
        draftId?: string;
        to?: string;
        subject?: string;
        body?: string;
        htmlBody?: string;
        cc?: string;
        bcc?: string;
        inReplyTo?: string;
        references?: string;
      },
    ) {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }

      if (resolved.entry.mode === "delegated_human") {
        return errorResult(
          'Action "send" is blocked in delegated_human mode. Create a draft instead and notify the human for review.',
        );
      }

      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "send",
      });
      if (!policy.allowed) {
        return errorResult(policy.reason);
      }

      try {
        const { accessToken, email } = await resolveAccessToken({
          config,
          email: resolved.entry.email,
          stateDir,
        });
        const client = new GmailClient(accessToken);

        let result;
        if (params.draftId) {
          result = await client.sendDraft(params.draftId);
        } else if (params.to && params.subject && params.body) {
          const raw = buildMimeMessage({
            from: email,
            to: params.to,
            subject: params.subject,
            body: params.body,
            htmlBody: params.htmlBody,
            cc: params.cc,
            bcc: params.bcc,
            inReplyTo: params.inReplyTo,
            references: params.references,
          });
          result = await client.sendMessage(raw);
        } else {
          return errorResult(
            "Provide either draftId (to send an existing draft) or to + subject + body (to compose and send).",
          );
        }

        return textResult(
          JSON.stringify({ messageId: result.id, threadId: result.threadId }, null, 2),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  api.registerTool((ctx) => ({
    name: "gmail_list_labels",
    label: "List Gmail labels",
    description: "List all Gmail labels",
    parameters: GmailListLabelsSchema,
    async execute() {
      const resolved = resolveMailEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No mail service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "mail",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "list_labels",
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
        const client = new GmailClient(accessToken);
        const labels = await client.listLabels();
        return textResult(JSON.stringify(labels, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
