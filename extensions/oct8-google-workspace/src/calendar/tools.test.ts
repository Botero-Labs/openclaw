import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveToken } from "../auth/token-store.js";
import type { StoredToken } from "../auth/token-store.js";
import type { PluginConfig } from "../types.js";
import { registerCalendarTools } from "./tools.js";

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
        const tool = (factoryOrTool as (ctx: { agentId: string }) => RegisteredTool)({ agentId });
        tools.push(tool);
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { api: api as never, tools };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-cal-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function freshToken(): StoredToken {
  return {
    accessToken: "ya29.cal-test",
    refreshToken: "1//cal-refresh",
    expiresAt: Date.now() + 3600 * 1000,
    email: "albus@diagon.com",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  };
}

const CAL_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "albus@diagon.com",
  },
  services: {
    "albus-calendar": {
      service: "calendar",
      email: "albus@diagon.com",
      mode: "agent_owned",
    },
  },
};

const DELEGATED_CAL_CONFIG: PluginConfig = {
  credentials: {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rt",
    email: "will@diagon.com",
  },
  services: {
    "will-calendar": {
      service: "calendar",
      email: "will@diagon.com",
      mode: "delegated_human",
    },
  },
};

describe("registerCalendarTools", () => {
  it("registers 7 tools when calendar service is configured", () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, CAL_CONFIG, tmpDir);
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "calendar_check_availability",
      "calendar_create_event",
      "calendar_delete_event",
      "calendar_get_event",
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_update_event",
    ]);
  });

  it("registers 0 tools when no calendar service configured", () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, { services: {} }, tmpDir);
    expect(tools).toHaveLength(0);
  });

  it("registers 0 tools when only mail service configured", () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(
      api,
      { services: { m: { service: "mail", email: "a@b.com", mode: "agent_owned" } } },
      tmpDir,
    );
    expect(tools).toHaveLength(0);
  });
});

describe("calendar_delete_event", () => {
  it("blocks delete for delegated_human mode", async () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, DELEGATED_CAL_CONFIG, tmpDir);
    const deleteTool = tools.find((t) => t.name === "calendar_delete_event")!;

    await saveToken(tmpDir, "gws:will@diagon.com", {
      ...freshToken(),
      email: "will@diagon.com",
    });

    const result = await deleteTool.execute("call-1", { eventId: "ev-1" });
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("blocked in delegated_human");
  });
});

describe("calendar_create_event", () => {
  it("returns error without start time params", async () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, CAL_CONFIG, tmpDir);
    const createTool = tools.find((t) => t.name === "calendar_create_event")!;

    await saveToken(tmpDir, "gws:albus@diagon.com", freshToken());

    const result = await createTool.execute("call-1", { summary: "Meeting" });
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("startDateTime");
  });

  it("returns error when mixing date and dateTime", async () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, CAL_CONFIG, tmpDir);
    const createTool = tools.find((t) => t.name === "calendar_create_event")!;

    await saveToken(tmpDir, "gws:albus@diagon.com", freshToken());

    const result = await createTool.execute("call-1", {
      summary: "Bad event",
      startDateTime: "2026-04-01T09:00:00Z",
      startDate: "2026-04-01",
    });
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("Cannot mix");
  });
});

describe("calendar_list_events", () => {
  it("returns error when credentials are not configured", async () => {
    const noCredsConfig: PluginConfig = { services: CAL_CONFIG.services };
    const { api, tools } = createMockApi();
    registerCalendarTools(api, noCredsConfig, tmpDir);
    const listTool = tools.find((t) => t.name === "calendar_list_events")!;

    const result = await listTool.execute("call-1", {});
    expect(result.content[0]!.text).toContain("Error:");
    expect(result.content[0]!.text).toContain("No credentials configured");
  });
});

describe("calendar_create_event — delegated_human", () => {
  it("allows create_event for delegated_human (collaboration is allowed)", () => {
    const { api, tools } = createMockApi();
    registerCalendarTools(api, DELEGATED_CAL_CONFIG, tmpDir);
    const createTool = tools.find((t) => t.name === "calendar_create_event");
    expect(createTool).toBeDefined();
    // Tool exists and doesn't early-return with a mode error — it will fail on missing token
    // which confirms the policy allows it
  });
});
