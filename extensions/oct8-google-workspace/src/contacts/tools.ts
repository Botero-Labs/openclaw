import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveAccessToken } from "../auth/resolve.js";
import { getServicesForKind } from "../config.js";
import { checkPolicy } from "../policy.js";
import type { ApiError, PluginConfig, ServiceEntry } from "../types.js";
import { ContactsClient, type Person } from "./client.js";
import {
  ContactsCreateSchema,
  ContactsGetSchema,
  ContactsListSchema,
  ContactsSearchSchema,
  ContactsUpdateSchema,
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
  return errorResult(`People API error (${err.code}): ${err.message}${retryHint}`);
}

function resolveContactsEntry(
  config: PluginConfig,
  agentId: string | undefined,
): { id: string; entry: ServiceEntry } | undefined {
  const services = getServicesForKind(config, "contacts");
  for (const svc of services) {
    const agents = svc.entry.allowedAgents;
    if (!agents || agents.length === 0 || (agentId !== undefined && agents.includes(agentId))) {
      return svc;
    }
  }
  return undefined;
}

export function registerContactsTools(
  api: OpenClawPluginApi,
  config: PluginConfig,
  stateDir: string,
): void {
  const contactsServices = getServicesForKind(config, "contacts");
  if (contactsServices.length === 0) {
    return;
  }

  // --- contacts_list ---
  api.registerTool((ctx) => ({
    name: "contacts_list",
    label: "List contacts",
    description: "List all contacts with pagination",
    parameters: ContactsListSchema,
    async execute(
      _id: string,
      params: { pageSize?: number; pageToken?: string; sortOrder?: string },
    ) {
      const resolved = resolveContactsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No contacts service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "contacts",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "list_contacts",
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
        const client = new ContactsClient(accessToken);
        const result = await client.listContacts(
          params as Parameters<ContactsClient["listContacts"]>[0],
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

  // --- contacts_search ---
  api.registerTool((ctx) => ({
    name: "contacts_search",
    label: "Search contacts",
    description: "Search contacts by name, email, phone, or organization (prefix matching)",
    parameters: ContactsSearchSchema,
    async execute(_id: string, params: { query: string; pageSize?: number }) {
      const resolved = resolveContactsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No contacts service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "contacts",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "search_contacts",
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
        const client = new ContactsClient(accessToken);
        const result = await client.searchContacts(params.query, params.pageSize);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- contacts_get ---
  api.registerTool((ctx) => ({
    name: "contacts_get",
    label: "Get contact",
    description: "Get a single contact by resource name",
    parameters: ContactsGetSchema,
    async execute(_id: string, params: { resourceName: string }) {
      const resolved = resolveContactsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No contacts service configured for this agent.");
      }
      const policy = checkPolicy({
        config,
        serviceKind: "contacts",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "get_contact",
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
        const client = new ContactsClient(accessToken);
        const result = await client.getContact(params.resourceName);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- contacts_create ---
  api.registerTool((ctx) => ({
    name: "contacts_create",
    label: "Create contact",
    description: "Create a new contact",
    parameters: ContactsCreateSchema,
    async execute(
      _id: string,
      params: {
        givenName: string;
        familyName?: string;
        email?: string;
        emailType?: string;
        phone?: string;
        phoneType?: string;
        organization?: string;
        title?: string;
      },
    ) {
      const resolved = resolveContactsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No contacts service configured for this agent.");
      }

      if (resolved.entry.mode === "delegated_human") {
        return errorResult('Action "create_contact" is blocked in delegated_human mode.');
      }

      const policy = checkPolicy({
        config,
        serviceKind: "contacts",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "create_contact",
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
        const person: Partial<Person> = {
          names: [{ givenName: params.givenName, familyName: params.familyName }],
        };
        if (params.email) {
          person.emailAddresses = [{ value: params.email, type: params.emailType }];
        }
        if (params.phone) {
          person.phoneNumbers = [{ value: params.phone, type: params.phoneType }];
        }
        if (params.organization) {
          person.organizations = [{ name: params.organization, title: params.title }];
        }

        const client = new ContactsClient(accessToken);
        const result = await client.createContact(person);
        return textResult(
          JSON.stringify(
            {
              resourceName: result.resourceName,
              names: result.names,
              emailAddresses: result.emailAddresses,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));

  // --- contacts_update ---
  api.registerTool((ctx) => ({
    name: "contacts_update",
    label: "Update contact",
    description: "Update an existing contact (fetches current contact for etag, merges changes)",
    parameters: ContactsUpdateSchema,
    async execute(
      _id: string,
      params: {
        resourceName: string;
        givenName?: string;
        familyName?: string;
        email?: string;
        emailType?: string;
        phone?: string;
        phoneType?: string;
        organization?: string;
        title?: string;
      },
    ) {
      const resolved = resolveContactsEntry(config, ctx.agentId);
      if (!resolved) {
        return errorResult("No contacts service configured for this agent.");
      }

      if (resolved.entry.mode === "delegated_human") {
        return errorResult('Action "update_contact" is blocked in delegated_human mode.');
      }

      const policy = checkPolicy({
        config,
        serviceKind: "contacts",
        email: resolved.entry.email,
        agentId: ctx.agentId,
        action: "update_contact",
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
        const client = new ContactsClient(accessToken);

        // Fetch current contact for etag (required by API)
        const current = await client.getContact(params.resourceName);

        const updateFields: string[] = [];
        const person: Partial<Person> = {
          etag: current.etag,
          metadata: current.metadata,
        };

        if (params.givenName !== undefined || params.familyName !== undefined) {
          person.names = [
            {
              givenName: params.givenName ?? current.names?.[0]?.givenName,
              familyName: params.familyName ?? current.names?.[0]?.familyName,
            },
          ];
          updateFields.push("names");
        }
        if (params.email !== undefined) {
          person.emailAddresses = [{ value: params.email, type: params.emailType }];
          updateFields.push("emailAddresses");
        }
        if (params.phone !== undefined) {
          person.phoneNumbers = [{ value: params.phone, type: params.phoneType }];
          updateFields.push("phoneNumbers");
        }
        if (params.organization !== undefined || params.title !== undefined) {
          person.organizations = [
            {
              name: params.organization ?? current.organizations?.[0]?.name,
              title: params.title ?? current.organizations?.[0]?.title,
            },
          ];
          updateFields.push("organizations");
        }

        if (updateFields.length === 0) {
          return errorResult("No fields to update. Provide at least one field to change.");
        }

        const result = await client.updateContact({
          resourceName: params.resourceName,
          person,
          updatePersonFields: updateFields.join(","),
        });
        return textResult(
          JSON.stringify(
            {
              resourceName: result.resourceName,
              names: result.names,
              emailAddresses: result.emailAddresses,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        if ((err as ApiError).code) {
          return formatApiError(err as ApiError);
        }
        return errorResult(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    },
  }));
}
