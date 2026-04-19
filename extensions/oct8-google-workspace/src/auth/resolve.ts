/**
 * Token resolution — the plugin's only auth responsibility.
 *
 * The oct8 platform handles the OAuth consent flow (admin completes it
 * in the dashboard). The platform stores the refresh token + client
 * credentials in Vault. At runtime, the coworker receives them via
 * SecretRef. This module refreshes the access token locally using
 * those Vault-provided credentials.
 */

import type { PluginConfig, SecretInput } from "../types.js";
import { isTokenExpiringSoon, refreshAccessToken, verifyTokenEmail } from "./oauth.js";
import { loadToken, saveToken } from "./token-store.js";
import type { StoredToken } from "./token-store.js";

type FetchFn = typeof globalThis.fetch;

export type ResolvedAccess = {
  accessToken: string;
  email: string;
};

/**
 * Resolve a valid access token for the configured email.
 *
 * 1. Check local token cache (fast path — no network call)
 * 2. If expired or near expiry → refresh using Vault-provided credentials
 * 3. If no cached token → do initial refresh using the refresh token from config
 */
export async function resolveAccessToken(params: {
  config: PluginConfig;
  email: string;
  stateDir: string;
  fetchFn?: FetchFn;
}): Promise<ResolvedAccess> {
  const { config, email, stateDir, fetchFn } = params;
  const credentials = config.credentials;

  if (!credentials) {
    throw new Error(
      "No credentials configured. The oct8 platform must provision Google OAuth " +
        "credentials for this coworker via the dashboard.",
    );
  }

  // Fail fast if the requested email doesn't match the provisioned credentials
  if (email.toLowerCase() !== credentials.email.toLowerCase()) {
    throw new Error(
      `Credential mismatch: services are configured for "${email}" but credentials ` +
        `are provisioned for "${credentials.email}". Update the credentials or service config.`,
    );
  }

  const profileKey = `gws:${email}`;

  // Fast path: check cached access token
  const cached = await loadToken(stateDir, profileKey);
  if (cached && !isTokenExpiringSoon(cached)) {
    return { accessToken: cached.accessToken, email: cached.email };
  }

  // Resolve secrets from Vault (or literal strings for dev)
  const clientId = resolveSecretString(credentials.clientId);
  const clientSecret = resolveSecretString(credentials.clientSecret);
  const refreshToken = cached?.refreshToken ?? resolveSecretString(credentials.refreshToken);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google OAuth credentials are incomplete. Ensure clientId, clientSecret, and " +
        "refreshToken are provisioned in the plugin credentials config.",
    );
  }

  // Refresh access token (mutex-protected per email in oauth.ts)
  const refreshed = await refreshAccessToken({
    email,
    refreshToken,
    clientId,
    clientSecret,
    fetchFn,
  });

  // Defense in depth: verify the refreshed token belongs to the expected email
  await verifyTokenEmail(refreshed.accessToken, email, fetchFn);

  const token: StoredToken = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    email,
    scopes: [],
  };

  await saveToken(stateDir, profileKey, token);
  return { accessToken: token.accessToken, email };
}

/**
 * Resolve a SecretInput to a plain string.
 * SecretRefs from oct8 Vault should be resolved by OpenClaw's secret
 * resolution layer before reaching the plugin config. If a SecretRef
 * object is still present, resolution failed.
 */
function resolveSecretString(input: SecretInput | undefined): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  // Unresolved SecretRef — do not leak vault path in error
  throw new Error(
    "OAuth credential is not available — an unresolved SecretRef was found. " +
      "Ensure the secrets provider is configured and the gateway can reach the oct8 API.",
  );
}
