import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveToken } from "../auth/token-store.js";
import type { StoredToken } from "../auth/token-store.js";
import type { PluginConfig } from "../types.js";
import { registerGmailTools } from "./tools.js";

// Minimal mock of OpenClawPluginApi that captures registered tools
type RegisteredTool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

function createMockApi() {
  const tools: RegisteredTool[] = [];
  const api = {
    registerTool: (factoryOrTool: unknown) => {
      if (typeof factoryOrTool === "function") {
        const tool = factoryOrTool({ agentId: "test-agent" }) as RegisteredTool;
        tools.push(tool);
      } else {
        tools.push(factoryOrTool as RegisteredTool);
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { api: api as never, tools };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-tools-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function freshToken(): StoredToken {
  return {
    accessToken: "ya29.test-access",
    refreshToken: "1//test-refresh",
    expiresAt: Date.now() + 3600 * 1000,
    email: "albus@diagon.com",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  };
}

const MAIL_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-mail": {
      service: "mail",
      email: "albus@diagon.com",
      mode: "agent_owned",
    },
  },
};

const DELEGATED_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "will@diagon.com",
  },
  services: {
    "will-mail": {
      service: "mail",
      email: "will@diagon.com",
      mode: "delegated_human",
    },
  },
};

const RESTRICTED_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-mail": {
      service: "mail",
      email: "albus@diagon.com",
      mode: "agent_owned",
      allowedAgents: ["inbox-triage"],
    },
  },
};

describe("registerGmailTools", () => {
  it("registers 8 tools when mail service is configured", () => {
    const { api, tools } = createMockApi();
    registerGmailTools(api, MAIL_CONFIG, tmpDir);
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.name).toSorted();
    expect(names).toEqual([
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

  it("registers 0 tools when no mail service is configured", () => {
    const { api, tools } = createMockApi();
    registerGmailTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });

  it("registers 0 tools when only calendar service is configured", () => {
    const { api, tools } = createMockApi();
    registerGmailTools(
      api,
      { services: { cal: { service: "calendar", email: "a@b.com", mode: "agent_owned" } } },
      tmpDir,
    );
    expect(tools).toHaveLength(0);
  });
});

describe("gmail_send", () => {
  it("returns policy error for delegated_human mode", async () => {
    const { api, tools } = createMockApi();
    registerGmailTools(api, DELEGATED_CONFIG, tmpDir);
    const sendTool = tools.find((t) => t.name === "gmail_send")!;

    // Need a token for will@diagon.com
    await saveToken(tmpDir, "gws:will@diagon.com", {
      ...freshToken(),
      email: "will@diagon.com",
    });

    const result = (await sendTool.execute("call-1", { draftId: "draft-1" })) as {
      content: Array<{ text: string }>;
      error?: boolean;
    };

    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("blocked in delegated_human");
  });
});

describe("gmail_create_draft", () => {
  it("returns error for unauthorized agent", () => {
    // Create api mock with different agentId
    const tools: RegisteredTool[] = [];
    const api = {
      registerTool: (factory: unknown) => {
        if (typeof factory === "function") {
          const tool = (factory as (ctx: { agentId: string }) => RegisteredTool)({
            agentId: "unauthorized-agent",
          });
          tools.push(tool);
        }
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };

    registerGmailTools(api as never, RESTRICTED_CONFIG, tmpDir);
    const draftTool = tools.find((t) => t.name === "gmail_create_draft")!;

    return draftTool
      .execute("call-1", { to: "x@y.com", subject: "test", body: "hi" })
      .then((result) => {
        const r = result as { content: Array<{ text: string }> };
        expect(r.content[0].text).toContain("Error:");
        expect(r.content[0].text).toContain("No mail service configured");
      });
  });
});

describe("gmail_search_threads", () => {
  it("returns error when credentials are not configured", async () => {
    const noCredsConfig: PluginConfig = { services: MAIL_CONFIG.services };
    const { api, tools } = createMockApi();
    registerGmailTools(api, noCredsConfig, tmpDir);
    const searchTool = tools.find((t) => t.name === "gmail_search_threads")!;

    const result = (await searchTool.execute("call-1", { query: "is:unread" })) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("No credentials configured");
  });
});
