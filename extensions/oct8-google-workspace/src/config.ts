import {
  ACTIONS_BY_SERVICE,
  DESTRUCTIVE_ACTIONS_BY_SERVICE,
  SCOPES_BY_SERVICE_AND_MODE,
  SERVICE_KINDS,
  SERVICE_MODES,
} from "./constants.js";
import type {
  CredentialsConfig,
  PluginConfig,
  PubSubConfig,
  SecretInput,
  ServiceEntry,
  ServiceKind,
} from "./types.js";

type ParseResult = {
  config: PluginConfig | null;
  issues: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse and validate raw plugin config from the manifest. */
export function parsePluginConfig(raw: unknown): ParseResult {
  const issues: string[] = [];

  if (!raw || !isRecord(raw)) {
    return { config: null, issues };
  }

  // Detect legacy keys
  if ("mailboxes" in raw) {
    issues.push(
      'Found legacy "mailboxes" key — please migrate to "services". See oct8 Google Workspace plugin docs.',
    );
  }
  if ("oauth" in raw) {
    issues.push(
      'Found legacy "oauth" key — please migrate to "credentials". OAuth flows are now managed by the oct8 platform.',
    );
  }

  const servicesRaw = raw["services"];
  if (!servicesRaw || !isRecord(servicesRaw)) {
    if ("services" in raw) {
      issues.push('"services" must be an object keyed by service ID.');
    }
    return { config: null, issues };
  }

  const services: Record<string, ServiceEntry> = {};
  const seen = new Set<string>();

  for (const [id, entryRaw] of Object.entries(servicesRaw)) {
    if (!isRecord(entryRaw)) {
      issues.push(`services.${id}: must be an object.`);
      continue;
    }
    const entry = parseServiceEntry(id, entryRaw, issues, seen);
    if (entry) {
      services[id] = entry;
    }
  }

  const credentials = parseCredentialsConfig(raw["credentials"], issues);
  const pubsub = parsePubSubConfig(raw["pubsub"], issues);

  return {
    config: { services, credentials, pubsub },
    issues,
  };
}

function parseServiceEntry(
  id: string,
  raw: Record<string, unknown>,
  issues: string[],
  seen: Set<string>,
): ServiceEntry | null {
  const prefix = `services.${id}`;

  const service = raw["service"] as string | undefined;
  if (!service || !SERVICE_KINDS.includes(service as ServiceKind)) {
    issues.push(
      `${prefix}.service: must be one of ${SERVICE_KINDS.join(", ")}. Got "${String(service)}".`,
    );
    return null;
  }

  const emailRaw = raw["email"];
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    issues.push(`${prefix}.email: required.`);
    return null;
  }
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    issues.push(`${prefix}.email: invalid email format "${email}".`);
    return null;
  }

  const mode = raw["mode"] as string | undefined;
  if (!mode || !SERVICE_MODES.includes(mode as ServiceEntry["mode"])) {
    issues.push(
      `${prefix}.mode: must be "delegated_human" or "agent_owned". Got "${String(mode)}".`,
    );
    return null;
  }

  // Duplicate detection
  const dedupeKey = `${email}:${service}:${mode}`;
  if (seen.has(dedupeKey)) {
    issues.push(`${prefix}: duplicate entry for (${email}, ${service}, ${mode}).`);
    return null;
  }
  seen.add(dedupeKey);

  // Validate allowedAgents
  let allowedAgents: string[] | undefined;
  if (Array.isArray(raw["allowedAgents"])) {
    allowedAgents = (raw["allowedAgents"] as unknown[])
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim());
  }

  // Validate allowedActions
  let allowedActions: string[] | undefined;
  const validActions = ACTIONS_BY_SERVICE[service as ServiceKind];
  if (Array.isArray(raw["allowedActions"])) {
    allowedActions = [];
    for (const actionRaw of raw["allowedActions"] as unknown[]) {
      if (typeof actionRaw !== "string") continue;
      const action = actionRaw.trim();
      if (!validActions.includes(action)) {
        issues.push(
          `${prefix}.allowedActions: unknown action "${action}" for service "${service}".`,
        );
        continue;
      }
      // Warn if a destructive action is listed for delegated_human
      const destructive = DESTRUCTIVE_ACTIONS_BY_SERVICE[service as ServiceKind];
      if (mode === "delegated_human" && destructive.includes(action)) {
        issues.push(
          `${prefix}.allowedActions: "${action}" is listed but will be blocked by delegated_human mode.`,
        );
      }
      allowedActions.push(action);
    }
  }

  return {
    service: service as ServiceKind,
    email,
    mode: mode as ServiceEntry["mode"],
    allowedAgents,
    allowedActions,
  };
}

function parseCredentialsConfig(raw: unknown, issues: string[]): CredentialsConfig | undefined {
  if (!raw || !isRecord(raw)) return undefined;

  const clientId = parseSecretInput(raw["clientId"], "credentials.clientId", issues);
  const clientSecret = parseSecretInput(raw["clientSecret"], "credentials.clientSecret", issues);
  const refreshToken = parseSecretInput(raw["refreshToken"], "credentials.refreshToken", issues);

  if (!clientId) issues.push("credentials.clientId: required.");
  if (!clientSecret) issues.push("credentials.clientSecret: required.");
  if (!refreshToken) issues.push("credentials.refreshToken: required.");

  // Warn when sensitive credentials are literal strings (should be SecretRefs in production)
  if (typeof clientSecret === "string") {
    issues.push(
      "credentials.clientSecret: literal string detected — use a SecretRef from Vault in production.",
    );
  }
  if (typeof refreshToken === "string") {
    issues.push(
      "credentials.refreshToken: literal string detected — use a SecretRef from Vault in production.",
    );
  }

  const emailRaw = raw["email"];
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    issues.push("credentials.email: required.");
    return undefined;
  }

  if (!clientId || !clientSecret || !refreshToken) return undefined;

  return {
    clientId,
    clientSecret,
    refreshToken,
    email: emailRaw.trim().toLowerCase(),
  };
}

function parsePubSubConfig(raw: unknown, issues: string[]): PubSubConfig | undefined {
  if (!raw || !isRecord(raw)) return undefined;
  void issues;
  return {
    enabled: raw["enabled"] === true,
    gcpProject: ((raw["gcpProject"] as string) ?? "").trim(),
    topic: typeof raw["topic"] === "string" ? raw["topic"].trim() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Secret input parsing
// ---------------------------------------------------------------------------

/**
 * Parse a SecretInput value — either a literal string or a SecretRef object.
 * SecretRef format: { source: "exec", provider: "oct8", id: "org:secret-name" }
 */
function parseSecretInput(raw: unknown, path: string, issues: string[]): SecretInput | undefined {
  if (raw === undefined || raw === null) return undefined;

  // SecretRef object (from oct8 Vault via deploy endpoint)
  if (
    isRecord(raw) &&
    typeof raw["source"] === "string" &&
    typeof raw["provider"] === "string" &&
    typeof raw["id"] === "string"
  ) {
    return { source: raw["source"], provider: raw["provider"], id: raw["id"] };
  }

  // Literal string
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed;
  }

  issues.push(`${path}: must be a string or a SecretRef object ({ source, provider, id }).`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get all service entries for a specific service kind. */
export function getServicesForKind(
  config: PluginConfig,
  kind: ServiceKind,
): Array<{ id: string; entry: ServiceEntry }> {
  const results: Array<{ id: string; entry: ServiceEntry }> = [];
  for (const [id, entry] of Object.entries(config.services)) {
    if (entry.service === kind) {
      results.push({ id, entry });
    }
  }
  return results;
}

/** Get all service entries for a specific email address. */
export function getServicesForEmail(
  config: PluginConfig,
  email: string,
): Array<{ id: string; entry: ServiceEntry }> {
  const normalized = email.trim().toLowerCase();
  const results: Array<{ id: string; entry: ServiceEntry }> = [];
  for (const [id, entry] of Object.entries(config.services)) {
    if (entry.email === normalized) {
      results.push({ id, entry });
    }
  }
  return results;
}

/** Compute the union of OAuth scopes for all service entries sharing an email. */
export function computeScopesForEmail(config: PluginConfig, email: string): string[] {
  const entries = getServicesForEmail(config, email);
  const scopeSet = new Set<string>();
  for (const { entry } of entries) {
    const serviceScopes = SCOPES_BY_SERVICE_AND_MODE[entry.service]?.[entry.mode];
    if (serviceScopes) {
      for (const s of serviceScopes) scopeSet.add(s);
    }
  }
  return Array.from(scopeSet).sort();
}
