import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginConfig } from "../types.js";
import { registerContactsTools } from "./tools.js";

type RegisteredTool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ text: string }> }>;
};

function createMockApi(agentId = "test-agent") {
  const tools: RegisteredTool[] = [];
  const api = {
    registerTool: (factoryOrTool: unknown) => {
      if (typeof factoryOrTool === "function") {
        tools.push((factoryOrTool as (ctx: { agentId: string }) => RegisteredTool)({ agentId }));
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { api: api as never, tools };
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-contacts-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const CONTACTS_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-contacts": { service: "contacts", email: "albus@diagon.com", mode: "agent_owned" },
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
    "will-contacts": { service: "contacts", email: "will@diagon.com", mode: "delegated_human" },
  },
};

describe("registerContactsTools", () => {
  it("registers 5 tools when contacts service is configured", () => {
    const { api, tools } = createMockApi();
    registerContactsTools(api, CONTACTS_CONFIG, tmpDir);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "contacts_create",
      "contacts_get",
      "contacts_list",
      "contacts_search",
      "contacts_update",
    ]);
  });

  it("registers 0 tools when no contacts service configured", () => {
    const { api, tools } = createMockApi();
    registerContactsTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });
});

describe("contacts_create — delegated_human", () => {
  it("blocks create for delegated_human mode", async () => {
    const { api, tools } = createMockApi();
    registerContactsTools(api, DELEGATED_CONFIG, tmpDir);
    const createTool = tools.find((t) => t.name === "contacts_create")!;
    const result = await createTool.execute("call-1", { givenName: "Test" });
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("blocked in delegated_human");
  });
});

describe("contacts_update — delegated_human", () => {
  it("blocks update for delegated_human mode", async () => {
    const { api, tools } = createMockApi();
    registerContactsTools(api, DELEGATED_CONFIG, tmpDir);
    const updateTool = tools.find((t) => t.name === "contacts_update")!;
    const result = await updateTool.execute("call-1", {
      resourceName: "people/c123",
      givenName: "Updated",
    });
    expect(result.content[0].text).toContain("Error:");
    expect(result.content[0].text).toContain("blocked in delegated_human");
  });
});
