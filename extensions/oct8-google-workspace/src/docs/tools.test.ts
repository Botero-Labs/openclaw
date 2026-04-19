import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginConfig } from "../types.js";
import { registerDocsTools } from "./tools.js";

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
    registerTool: (f: unknown) => {
      if (typeof f === "function") {
        tools.push((f as (ctx: { agentId: string }) => RegisteredTool)({ agentId }));
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { api: api as never, tools };
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-docs-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const DOCS_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: { "albus-docs": { service: "docs", email: "albus@diagon.com", mode: "agent_owned" } },
};

describe("registerDocsTools", () => {
  it("registers 2 tools when docs service is configured", () => {
    const { api, tools } = createMockApi();
    registerDocsTools(api, DOCS_CONFIG, tmpDir);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "docs_export_document",
      "docs_read_document",
    ]);
  });

  it("registers 0 tools when no docs service", () => {
    const { api, tools } = createMockApi();
    registerDocsTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });

  it("both tools work in delegated_human mode (read-only)", () => {
    const delegatedConfig: PluginConfig = {
      credentials: {
        clientId: "cid",
        clientSecret: "csec",
        refreshToken: "rt",
        email: "albus@diagon.com",
      },
      services: {
        "will-docs": { service: "docs", email: "will@diagon.com", mode: "delegated_human" },
      },
    };
    const { api, tools } = createMockApi();
    registerDocsTools(api, delegatedConfig, tmpDir);
    expect(tools).toHaveLength(2); // Both registered — no mode blocking for read-only
  });
});
