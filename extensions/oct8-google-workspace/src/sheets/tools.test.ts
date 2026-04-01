import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginConfig } from "../types.js";
import { registerSheetsTools } from "./tools.js";

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
      if (typeof f === "function")
        tools.push((f as (ctx: { agentId: string }) => RegisteredTool)({ agentId }));
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { api: api as never, tools };
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-sheets-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const SHEETS_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-sheets": { service: "sheets", email: "albus@diagon.com", mode: "agent_owned" },
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
    "will-sheets": { service: "sheets", email: "will@diagon.com", mode: "delegated_human" },
  },
};

describe("registerSheetsTools", () => {
  it("registers 5 tools when sheets service is configured", () => {
    const { api, tools } = createMockApi();
    registerSheetsTools(api, SHEETS_CONFIG, tmpDir);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "sheets_append_rows",
      "sheets_clear_range",
      "sheets_get_metadata",
      "sheets_read_range",
      "sheets_write_range",
    ]);
  });

  it("registers 0 tools when no sheets service", () => {
    const { api, tools } = createMockApi();
    registerSheetsTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });

  it("blocks write_range for delegated_human", async () => {
    const { api, tools } = createMockApi();
    registerSheetsTools(api, DELEGATED_CONFIG, tmpDir);
    const writeTool = tools.find((t) => t.name === "sheets_write_range")!;
    const result = await writeTool.execute("call-1", {
      spreadsheetId: "s1",
      range: "A1",
      values: [[1]],
    });
    expect(result.content[0]!.text).toContain("blocked in delegated_human");
  });

  it("blocks append_rows for delegated_human", async () => {
    const { api, tools } = createMockApi();
    registerSheetsTools(api, DELEGATED_CONFIG, tmpDir);
    const appendTool = tools.find((t) => t.name === "sheets_append_rows")!;
    const result = await appendTool.execute("call-1", {
      spreadsheetId: "s1",
      range: "A:A",
      values: [[1]],
    });
    expect(result.content[0]!.text).toContain("blocked in delegated_human");
  });

  it("blocks clear_range for delegated_human", async () => {
    const { api, tools } = createMockApi();
    registerSheetsTools(api, DELEGATED_CONFIG, tmpDir);
    const clearTool = tools.find((t) => t.name === "sheets_clear_range")!;
    const result = await clearTool.execute("call-1", { spreadsheetId: "s1", range: "A1:Z" });
    expect(result.content[0]!.text).toContain("blocked in delegated_human");
  });
});
