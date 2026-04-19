import { describe, expect, it } from "vitest";
import {
  computeScopesForEmail,
  getServicesForEmail,
  getServicesForKind,
  parsePluginConfig,
} from "./config.js";

const VALID_MAIL_ENTRY = {
  service: "mail",
  email: "will@diagon.com",
  mode: "delegated_human",
  allowedAgents: ["inbox-triage"],
  allowedActions: ["search_threads", "get_thread", "get_message", "create_draft"],
};

const VALID_CALENDAR_ENTRY = {
  service: "calendar",
  email: "albus@diagon.com",
  mode: "agent_owned",
};

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    services: { "will-gmail": VALID_MAIL_ENTRY, ...overrides },
  };
}

describe("parsePluginConfig", () => {
  it("parses a valid config with one mail service", () => {
    const { config, issues } = parsePluginConfig(validConfig());
    expect(issues).toEqual([]);
    expect(config).not.toBeNull();
    expect(Object.keys(config!.services)).toEqual(["will-gmail"]);
    expect(config!.services["will-gmail"].email).toBe("will@diagon.com");
  });

  it("parses a valid config with multiple services for different emails", () => {
    const { config, issues } = parsePluginConfig({
      services: {
        "will-gmail": VALID_MAIL_ENTRY,
        "albus-calendar": VALID_CALENDAR_ENTRY,
      },
    });
    expect(issues).toEqual([]);
    expect(Object.keys(config!.services)).toHaveLength(2);
  });

  it("returns null config for empty/missing input", () => {
    expect(parsePluginConfig(null).config).toBeNull();
    expect(parsePluginConfig(undefined).config).toBeNull();
    expect(parsePluginConfig({}).config).toBeNull();
  });

  it("returns config with empty services and no issues", () => {
    const { config, issues } = parsePluginConfig({ services: {} });
    expect(config).not.toBeNull();
    expect(config!.services).toEqual({});
    expect(issues).toEqual([]);
  });

  it("produces issue for missing email", () => {
    const { issues } = parsePluginConfig({
      services: { x: { service: "mail", mode: "agent_owned" } },
    });
    expect(issues.some((i) => i.includes("email") && i.includes("required"))).toBe(true);
  });

  it("produces issue for invalid email format", () => {
    const { issues } = parsePluginConfig({
      services: { x: { service: "mail", email: "not-an-email", mode: "agent_owned" } },
    });
    expect(issues.some((i) => i.includes("invalid email format"))).toBe(true);
  });

  it("produces issue for unknown service kind", () => {
    const { issues } = parsePluginConfig({
      services: { x: { service: "fax", email: "a@b.com", mode: "agent_owned" } },
    });
    expect(issues.some((i) => i.includes("must be one of"))).toBe(true);
  });

  it("produces issue for unknown mode", () => {
    const { issues } = parsePluginConfig({
      services: { x: { service: "mail", email: "a@b.com", mode: "supervised" } },
    });
    expect(issues.some((i) => i.includes("delegated_human"))).toBe(true);
  });

  it("rejects duplicate (email, service, mode) tuple", () => {
    const { issues } = parsePluginConfig({
      services: {
        a: { service: "mail", email: "a@b.com", mode: "agent_owned" },
        b: { service: "mail", email: "a@b.com", mode: "agent_owned" },
      },
    });
    expect(issues.some((i) => i.includes("duplicate"))).toBe(true);
  });

  it("warns about unknown allowedActions", () => {
    const { issues } = parsePluginConfig({
      services: {
        x: { service: "mail", email: "a@b.com", mode: "agent_owned", allowedActions: ["teleport"] },
      },
    });
    expect(issues.some((i) => i.includes("unknown action") && i.includes("teleport"))).toBe(true);
  });

  it("warns when delegated_human lists destructive action in allowedActions", () => {
    const { issues } = parsePluginConfig({
      services: {
        x: { service: "mail", email: "a@b.com", mode: "delegated_human", allowedActions: ["send"] },
      },
    });
    expect(issues.some((i) => i.includes("blocked by delegated_human"))).toBe(true);
  });

  it("detects legacy mailboxes key", () => {
    const { issues } = parsePluginConfig({
      mailboxes: {},
      services: { "will-gmail": VALID_MAIL_ENTRY },
    });
    expect(issues.some((i) => i.includes("mailboxes") && i.includes("migrate"))).toBe(true);
  });

  it("detects legacy oauth key", () => {
    const { issues } = parsePluginConfig({
      oauth: {},
      services: { "will-gmail": VALID_MAIL_ENTRY },
    });
    expect(issues.some((i) => i.includes("oauth") && i.includes("credentials"))).toBe(true);
  });

  it("normalizes email to lowercase and trims whitespace", () => {
    const { config } = parsePluginConfig({
      services: {
        x: { service: "mail", email: "  Will@Diagon.COM  ", mode: "agent_owned" },
      },
    });
    expect(config!.services["x"].email).toBe("will@diagon.com");
  });

  it("parses credentials with literal strings and warns about production usage", () => {
    const { config, issues } = parsePluginConfig({
      credentials: {
        clientId: "client-id-123",
        clientSecret: "client-secret-456",
        refreshToken: "refresh-token-789",
        email: "albus@diagon.com",
      },
      services: { x: { service: "mail", email: "albus@diagon.com", mode: "agent_owned" } },
    });
    expect(config!.credentials).toBeDefined();
    expect(config!.credentials!.clientId).toBe("client-id-123");
    expect(config!.credentials!.email).toBe("albus@diagon.com");
    // Literal strings for secrets produce warnings (should be SecretRefs in production)
    expect(issues.some((i) => i.includes("clientSecret") && i.includes("literal string"))).toBe(
      true,
    );
    expect(issues.some((i) => i.includes("refreshToken") && i.includes("literal string"))).toBe(
      true,
    );
  });

  it("parses credentials with SecretRef objects", () => {
    const ref = { source: "exec", provider: "oct8", id: "diagon:google-client-secret" };
    const { config, issues } = parsePluginConfig({
      credentials: {
        clientId: "client-id",
        clientSecret: ref,
        refreshToken: { source: "exec", provider: "oct8", id: "diagon:google-refresh-token" },
        email: "albus@diagon.com",
      },
      services: { x: { service: "mail", email: "albus@diagon.com", mode: "agent_owned" } },
    });
    expect(issues).toEqual([]);
    expect(config!.credentials!.clientSecret).toEqual(ref);
  });

  it("reports missing credentials fields", () => {
    const { issues } = parsePluginConfig({
      credentials: { email: "a@b.com" },
      services: { x: { service: "mail", email: "a@b.com", mode: "agent_owned" } },
    });
    expect(issues.some((i) => i.includes("credentials.clientId: required"))).toBe(true);
    expect(issues.some((i) => i.includes("credentials.clientSecret: required"))).toBe(true);
    expect(issues.some((i) => i.includes("credentials.refreshToken: required"))).toBe(true);
  });
});

describe("getServicesForKind", () => {
  it("returns only entries matching the kind", () => {
    const { config } = parsePluginConfig({
      services: {
        "will-gmail": VALID_MAIL_ENTRY,
        "albus-calendar": VALID_CALENDAR_ENTRY,
      },
    });
    const mail = getServicesForKind(config!, "mail");
    expect(mail).toHaveLength(1);
    expect(mail[0].id).toBe("will-gmail");

    const calendar = getServicesForKind(config!, "calendar");
    expect(calendar).toHaveLength(1);
    expect(calendar[0].id).toBe("albus-calendar");
  });

  it("returns empty for unconfigured service kind", () => {
    const { config } = parsePluginConfig(validConfig());
    expect(getServicesForKind(config!, "drive")).toEqual([]);
  });
});

describe("getServicesForEmail", () => {
  it("returns all entries for a given email", () => {
    const { config } = parsePluginConfig({
      services: {
        "albus-mail": { service: "mail", email: "albus@diagon.com", mode: "agent_owned" },
        "albus-calendar": VALID_CALENDAR_ENTRY,
        "will-gmail": VALID_MAIL_ENTRY,
      },
    });
    const results = getServicesForEmail(config!, "albus@diagon.com");
    expect(results).toHaveLength(2);
  });
});

describe("computeScopesForEmail", () => {
  it("returns correct scopes for a single mail service", () => {
    const { config } = parsePluginConfig({
      services: { x: { service: "mail", email: "a@b.com", mode: "delegated_human" } },
    });
    const scopes = computeScopesForEmail(config!, "a@b.com");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.compose");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/gmail.modify");
  });

  it("returns union of scopes for multiple services on same email", () => {
    const { config } = parsePluginConfig({
      services: {
        a: { service: "mail", email: "a@b.com", mode: "agent_owned" },
        b: { service: "calendar", email: "a@b.com", mode: "delegated_human" },
      },
    });
    const scopes = computeScopesForEmail(config!, "a@b.com");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.events.readonly");
  });

  it("deduplicates scopes", () => {
    const { config } = parsePluginConfig({
      services: {
        a: { service: "docs", email: "a@b.com", mode: "delegated_human" },
        b: { service: "docs", email: "a@b.com", mode: "agent_owned" },
      },
    });
    const scopes = computeScopesForEmail(config!, "a@b.com");
    const docsScopes = scopes.filter((s) => s.includes("documents"));
    expect(docsScopes).toHaveLength(1);
  });
});
