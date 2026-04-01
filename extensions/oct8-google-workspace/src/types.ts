/**
 * A secret value — either a literal string or a SecretRef resolved by OpenClaw.
 * In production oct8 deployments, credentials flow through Supabase Vault via
 * the oct8-secrets CLI: { source: "exec", provider: "oct8", id: "org:secret-name" }
 */
export type SecretInput = string | { source: string; provider: string; id: string };

/** Supported Google Workspace service kinds. */
export type ServiceKind = "mail" | "calendar" | "drive" | "contacts" | "sheets" | "docs";

/** Mailbox / service access mode. */
export type ServiceMode = "delegated_human" | "agent_owned";

/** A single configured Google Workspace service entry. */
export type ServiceEntry = {
  /** Which Google service this entry configures. */
  service: ServiceKind;
  /** Google account email address. */
  email: string;
  /** Access mode — determines which actions are allowed. */
  mode: ServiceMode;
  /** Agent IDs allowed to use this service. Omit or empty to allow all agents. */
  allowedAgents?: string[];
  /** Actions allowed. Omit to allow all non-mode-blocked actions. Empty array = none. */
  allowedActions?: string[];
};

/**
 * Google OAuth credentials — provisioned by the oct8 platform during
 * coworker setup. The admin completes Google consent in the dashboard,
 * the platform stores tokens in Vault, and the coworker receives them
 * at runtime via SecretRef.
 *
 * The plugin never initiates OAuth flows — it only consumes and refreshes
 * credentials provided by the platform.
 */
export type CredentialsConfig = {
  /** Google OAuth client ID (from the GCP Web application client). */
  clientId: SecretInput;
  /** Google OAuth client secret — SecretRef from Vault in production. */
  clientSecret: SecretInput;
  /** Google OAuth refresh token — SecretRef from Vault in production. */
  refreshToken: SecretInput;
  /** Email address the refresh token was issued for. Used for verification. */
  email: string;
};

/** Pub/Sub configuration for real-time Gmail notifications. */
export type PubSubConfig = {
  enabled: boolean;
  gcpProject: string;
  topic?: string;
};

/** Complete plugin configuration. */
export type PluginConfig = {
  credentials?: CredentialsConfig;
  services: Record<string, ServiceEntry>;
  pubsub?: PubSubConfig;
};

/** Policy decision codes for authorization failures. */
export type PolicyCode =
  | "service_not_found"
  | "agent_not_authorized"
  | "mode_blocked"
  | "action_not_allowed";

/** Policy authorization result. */
export type PolicyDecision =
  | { allowed: true; entry: ServiceEntry; serviceId: string }
  | { allowed: false; code: PolicyCode; reason: string };

/** API error classification codes. */
export type ApiErrorCode =
  | "expired_token"
  | "forbidden"
  | "insufficient_scope"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "unknown";

/** Classified API error. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
