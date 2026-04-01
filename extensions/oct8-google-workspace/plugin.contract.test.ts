import { describe, expect, it } from "vitest";
import pluginEntry from "./index.js";

// Minimal mock of OpenClawPluginApi
function createContractApi(pluginConfig: unknown) {
  const registeredTools: string[] = [];
  const warnings: string[] = [];

  const api = {
    pluginConfig,
    stateDir: "/tmp/oct8-gws-contract-test",
    logger: {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
    },
    registerTool: (factoryOrTool: unknown) => {
      if (typeof factoryOrTool === "function") {
        const tool = (factoryOrTool as (ctx: { agentId?: string }) => { name: string })({});
        registeredTools.push(tool.name);
      } else {
        registeredTools.push((factoryOrTool as { name: string }).name);
      }
    },
  };

  return { api: api as never, registeredTools, warnings };
}

describe("oct8-google-workspace plugin contract", () => {
  it("has correct plugin id", () => {
    expect(pluginEntry.id).toBe("oct8-google-workspace");
  });

  it("has correct plugin name", () => {
    expect(pluginEntry.name).toBe("oct8 Google Workspace");
  });

  it("registers no tools with empty config", () => {
    const { api, registeredTools } = createContractApi({});
    pluginEntry.register(api);
    expect(registeredTools).toEqual([]);
  });

  it("registers no tools with null config", () => {
    const { api, registeredTools } = createContractApi(null);
    pluginEntry.register(api);
    expect(registeredTools).toEqual([]);
  });

  it("registers no tools with empty services", () => {
    const { api, registeredTools } = createContractApi({ services: {} });
    pluginEntry.register(api);
    expect(registeredTools).toEqual([]);
  });

  it("registers 8 Gmail tools when a mail service is configured", () => {
    const { api, registeredTools } = createContractApi({
      services: {
        "albus-mail": {
          service: "mail",
          email: "albus@diagon.com",
          mode: "agent_owned",
        },
      },
    });
    pluginEntry.register(api);

    expect(registeredTools).toHaveLength(8);
    expect(registeredTools.sort()).toEqual([
      "gmail_create_draft",
      "gmail_get_message",
      "gmail_get_thread",
      "gmail_list_labels",
      "gmail_search_messages",
      "gmail_search_threads",
      "gmail_send",
      "gmail_update_draft",
    ]);
  });

  it("registers 7 Calendar tools when a calendar service is configured", () => {
    const { api, registeredTools } = createContractApi({
      services: {
        "albus-cal": {
          service: "calendar",
          email: "albus@diagon.com",
          mode: "agent_owned",
        },
      },
    });
    pluginEntry.register(api);
    expect(registeredTools).toHaveLength(7);
    expect(registeredTools.sort()).toEqual([
      "calendar_check_availability",
      "calendar_create_event",
      "calendar_delete_event",
      "calendar_get_event",
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_update_event",
    ]);
  });

  it("registers 5 Drive tools when a drive service is configured", () => {
    const { api, registeredTools } = createContractApi({
      services: {
        "albus-drive": { service: "drive", email: "albus@diagon.com", mode: "agent_owned" },
      },
    });
    pluginEntry.register(api);
    expect(registeredTools).toHaveLength(5);
    expect(registeredTools.sort()).toEqual([
      "drive_download_file",
      "drive_export_file",
      "drive_get_file",
      "drive_search_files",
      "drive_upload_file",
    ]);
  });

  it("registers 32 tools when all 6 services are configured", () => {
    const { api, registeredTools } = createContractApi({
      services: {
        "albus-mail": { service: "mail", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-cal": { service: "calendar", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-drive": { service: "drive", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-contacts": { service: "contacts", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-sheets": { service: "sheets", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-docs": { service: "docs", email: "albus@diagon.com", mode: "agent_owned" },
      },
    });
    pluginEntry.register(api);
    expect(registeredTools).toHaveLength(32); // 8 + 7 + 5 + 5 + 5 + 2
  });

  it("logs warnings for invalid config", () => {
    const { api, warnings } = createContractApi({
      mailboxes: {},
      services: {
        x: { service: "fax", email: "bad", mode: "unknown" },
      },
    });
    pluginEntry.register(api);
    expect(warnings.some((w) => w.includes("mailboxes"))).toBe(true);
    expect(warnings.some((w) => w.includes("must be one of"))).toBe(true);
  });
});
