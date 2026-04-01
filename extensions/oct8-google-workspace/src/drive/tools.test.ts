import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginConfig } from "../types.js";
import { registerDriveTools } from "./tools.js";

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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-drive-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const DRIVE_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-drive": { service: "drive", email: "albus@diagon.com", mode: "agent_owned" },
  },
};

const DELEGATED_DRIVE_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "will@diagon.com",
  },
  services: {
    "will-drive": { service: "drive", email: "will@diagon.com", mode: "delegated_human" },
  },
};

describe("registerDriveTools", () => {
  it("registers 5 tools when drive service is configured", () => {
    const { api, tools } = createMockApi();
    registerDriveTools(api, DRIVE_CONFIG, tmpDir);
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "drive_download_file",
      "drive_export_file",
      "drive_get_file",
      "drive_search_files",
      "drive_upload_file",
    ]);
  });

  it("registers 0 tools when no drive service configured", () => {
    const { api, tools } = createMockApi();
    registerDriveTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });
});

describe("drive_upload_file", () => {
  it("blocks upload for delegated_human mode", async () => {
    const { api, tools } = createMockApi();
    registerDriveTools(api, DELEGATED_DRIVE_CONFIG, tmpDir);
    const uploadTool = tools.find((t) => t.name === "drive_upload_file")!;

    const result = await uploadTool.execute("call-1", {
      name: "test.txt",
      content: "hello",
      mimeType: "text/plain",
    });
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("blocked in delegated_human");
  });
});

describe("drive_search_files", () => {
  it("returns error when credentials are not configured", async () => {
    const noCredsConfig: PluginConfig = { services: DRIVE_CONFIG.services };
    const { api, tools } = createMockApi();
    registerDriveTools(api, noCredsConfig, tmpDir);
    const searchTool = tools.find((t) => t.name === "drive_search_files")!;

    const result = await searchTool.execute("call-1", { query: "name contains 'report'" });
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("No credentials configured");
  });
});
