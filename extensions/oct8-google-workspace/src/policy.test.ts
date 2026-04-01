import { describe, expect, it } from "vitest";
import { ACTIONS_BY_SERVICE, DESTRUCTIVE_ACTIONS_BY_SERVICE, SERVICE_KINDS } from "./constants.js";
import { checkPolicy, listAllowedActions } from "./policy.js";
import type { PluginConfig, ServiceKind } from "./types.js";

function makeConfig(
  services: Record<
    string,
    {
      service: string;
      email: string;
      mode: string;
      allowedAgents?: string[];
      allowedActions?: string[];
    }
  >,
): PluginConfig {
  return { services } as PluginConfig;
}

// ---------------------------------------------------------------------------
// Gate 1 — Service exists
// ---------------------------------------------------------------------------

describe("checkPolicy — gate 1: service exists", () => {
  it("returns service_not_found when no entry matches", () => {
    const config = makeConfig({});
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "search_threads",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("service_not_found");
    }
  });

  it("returns service_not_found when email does not match", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "other@b.com",
      agentId: "agent-1",
      action: "search_threads",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("service_not_found");
  });

  it("returns service_not_found when service kind does not match", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "calendar",
      email: "a@b.com",
      agentId: "agent-1",
      action: "list_events",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("service_not_found");
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — Agent authorized
// ---------------------------------------------------------------------------

describe("checkPolicy — gate 2: agent authorization", () => {
  it("allows agent in allowedAgents", () => {
    const config = makeConfig({
      x: {
        service: "mail",
        email: "a@b.com",
        mode: "agent_owned",
        allowedAgents: ["agent-1", "agent-2"],
      },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "search_threads",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies agent not in allowedAgents", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedAgents: ["agent-1"] },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-99",
      action: "search_threads",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("agent_not_authorized");
  });

  it("allows all agents when allowedAgents is omitted", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "any-agent",
      action: "search_threads",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows all agents when allowedAgents is empty array", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedAgents: [] },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "any-agent",
      action: "search_threads",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies undefined agentId when allowedAgents is defined", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedAgents: ["agent-1"] },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: undefined,
      action: "search_threads",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("agent_not_authorized");
  });

  it("allows undefined agentId when allowedAgents is omitted", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: undefined,
      action: "search_threads",
    });
    expect(result.allowed).toBe(true);
  });

  it("agent ID matching is case-sensitive", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedAgents: ["Agent-1"] },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "search_threads",
    });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate 3 — Mode gate (per service kind)
// ---------------------------------------------------------------------------

describe.each(SERVICE_KINDS)("checkPolicy — gate 3: mode gate for %s", (serviceKind) => {
  const destructive = DESTRUCTIVE_ACTIONS_BY_SERVICE[serviceKind];
  const nonDestructive = ACTIONS_BY_SERVICE[serviceKind].filter((a) => !destructive.includes(a));

  if (destructive.length > 0) {
    it.each(destructive)("blocks %s in delegated_human mode", (action) => {
      const config = makeConfig({
        x: { service: serviceKind, email: "a@b.com", mode: "delegated_human" },
      });
      const result = checkPolicy({
        config,
        serviceKind: serviceKind as ServiceKind,
        email: "a@b.com",
        agentId: "agent-1",
        action,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.code).toBe("mode_blocked");
    });

    it.each(destructive)("allows %s in agent_owned mode", (action) => {
      const config = makeConfig({
        x: { service: serviceKind, email: "a@b.com", mode: "agent_owned" },
      });
      const result = checkPolicy({
        config,
        serviceKind: serviceKind as ServiceKind,
        email: "a@b.com",
        agentId: "agent-1",
        action,
      });
      expect(result.allowed).toBe(true);
    });
  }

  if (nonDestructive.length > 0) {
    it.each(nonDestructive)("allows %s in delegated_human mode", (action) => {
      const config = makeConfig({
        x: { service: serviceKind, email: "a@b.com", mode: "delegated_human" },
      });
      const result = checkPolicy({
        config,
        serviceKind: serviceKind as ServiceKind,
        email: "a@b.com",
        agentId: "agent-1",
        action,
      });
      expect(result.allowed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Gate 4 — Action allowlist
// ---------------------------------------------------------------------------

describe("checkPolicy — gate 4: action allowlist", () => {
  it("allows action in allowedActions", () => {
    const config = makeConfig({
      x: {
        service: "mail",
        email: "a@b.com",
        mode: "agent_owned",
        allowedActions: ["search_threads", "get_thread"],
      },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "search_threads",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies action not in allowedActions", () => {
    const config = makeConfig({
      x: {
        service: "mail",
        email: "a@b.com",
        mode: "agent_owned",
        allowedActions: ["search_threads"],
      },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "send",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("action_not_allowed");
  });

  it("allows all valid actions when allowedActions is omitted", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "send",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies unknown action even when allowedActions is omitted", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned" },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "teleport",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("action_not_allowed");
  });

  it("mode gate wins over allowedActions — mode-blocked action in allowlist is still blocked", () => {
    const config = makeConfig({
      x: {
        service: "mail",
        email: "a@b.com",
        mode: "delegated_human",
        allowedActions: ["send", "search_threads"],
      },
    });
    const result = checkPolicy({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
      action: "send",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("mode_blocked");
  });
});

// ---------------------------------------------------------------------------
// listAllowedActions
// ---------------------------------------------------------------------------

describe("listAllowedActions", () => {
  it("returns all non-destructive actions for delegated_human with no allowlist", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "delegated_human" },
    });
    const actions = listAllowedActions({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
    });
    expect(actions).not.toContain("send");
    expect(actions).toContain("search_threads");
    expect(actions).toContain("create_draft");
  });

  it("returns intersection of mode-permitted and allowlist", () => {
    const config = makeConfig({
      x: {
        service: "mail",
        email: "a@b.com",
        mode: "agent_owned",
        allowedActions: ["search_threads", "send"],
      },
    });
    const actions = listAllowedActions({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
    });
    expect(actions).toEqual(["search_threads", "send"]);
  });

  it("returns empty when agent is not authorized", () => {
    const config = makeConfig({
      x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedAgents: ["other"] },
    });
    const actions = listAllowedActions({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
    });
    expect(actions).toEqual([]);
  });

  it("returns empty when no service entry exists", () => {
    const config = makeConfig({});
    const actions = listAllowedActions({
      config,
      serviceKind: "mail",
      email: "a@b.com",
      agentId: "agent-1",
    });
    expect(actions).toEqual([]);
  });
});
