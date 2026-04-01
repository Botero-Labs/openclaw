import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import {
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  TOKEN_REFRESH_SKEW_SECONDS,
} from "../constants.js";
import type { StoredToken } from "./token-store.js";

const refreshQueue = new KeyedAsyncQueue();

type FetchFn = typeof globalThis.fetch;

type RefreshResult = {
  accessToken: string;
  /** New refresh token if Google rotated it, otherwise the original. */
  refreshToken: string;
  expiresAt: number;
};

/**
 * Refresh an access token using a refresh token. Serialized per email via
 * KeyedAsyncQueue so concurrent agents sharing a mailbox don't race.
 */
export function refreshAccessToken(params: {
  email: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}): Promise<RefreshResult> {
  return refreshQueue.enqueue(params.email, () => doRefresh(params));
}

async function doRefresh(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}): Promise<RefreshResult> {
  const doFetch = params.fetchFn ?? globalThis.fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const res = await doFetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const truncated = (errBody || res.statusText).slice(0, 100);
    throw new Error(
      `Token refresh failed (${res.status}): ${truncated}. Re-authorization may be required.`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? params.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Verify that the token belongs to the expected email address. */
export async function verifyTokenEmail(
  accessToken: string,
  expectedEmail: string,
  fetchFn?: FetchFn,
): Promise<void> {
  const doFetch = fetchFn ?? globalThis.fetch;
  const res = await doFetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Email verification failed (${res.status}): could not fetch user info.`);
  }

  const data = (await res.json()) as { email?: string };
  const actual = (data.email ?? "").trim().toLowerCase();
  const expected = expectedEmail.trim().toLowerCase();

  if (actual !== expected) {
    throw new Error(
      "Token does not belong to the expected account. Re-authorize with the correct Google account.",
    );
  }
}

/** Check if a stored token needs refreshing (within the skew window). */
export function isTokenExpiringSoon(token: StoredToken): boolean {
  return Date.now() >= token.expiresAt - TOKEN_REFRESH_SKEW_SECONDS * 1000;
}

/** Expose the queue for testing. */
export function getRefreshQueueForTesting(): KeyedAsyncQueue {
  return refreshQueue;
}
