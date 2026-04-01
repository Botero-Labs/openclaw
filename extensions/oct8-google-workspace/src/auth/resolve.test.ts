import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginConfig } from "../types.js";
import { resolveAccessToken } from "./resolve.js";
import { saveToken } from "./token-store.js";
import type { StoredToken } from "./token-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-resolve-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const CONFIG: PluginConfig = {
  credentials: {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
    email: "albus@diagon.com",
  },
  services: {
    "albus-mail": { service: "mail", email: "albus@diagon.com", mode: "agent_owned" },
  },
};

function freshToken(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    accessToken: "ya29.valid-access",
    refreshToken: "1//valid-refresh",
    expiresAt: Date.now() + 3600 * 1000,
    email: "albus@diagon.com",
    scopes: [],
    ...overrides,
  };
}

describe("resolveAccessToken", () => {
  it("returns cached token when not expired", async () => {
    await saveToken(tmpDir, "gws:albus@diagon.com", freshToken());

    const result = await resolveAccessToken({
      config: CONFIG,
      email: "albus@diagon.com",
      stateDir: tmpDir,
    });
    expect(result.accessToken).toBe("ya29.valid-access");
    expect(result.email).toBe("albus@diagon.com");
  });

  it("refreshes when token is near expiry", async () => {
    const nearExpiry = freshToken({ expiresAt: Date.now() + 60 * 1000 });
    await saveToken(tmpDir, "gws:albus@diagon.com", nearExpiry);

    // fetchFn called twice: token refresh + email verification
    let callCount = 0;
    const fetchFn = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ access_token: "ya29.refreshed", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ email: "albus@diagon.com" }), { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await resolveAccessToken({
      config: CONFIG,
      email: "albus@diagon.com",
      stateDir: tmpDir,
      fetchFn,
    });

    expect(result.accessToken).toBe("ya29.refreshed");
    expect(callCount).toBe(2);
  });

  it("does initial refresh when no cached token exists", async () => {
    let callCount = 0;
    const fetchFn = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ access_token: "ya29.initial", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ email: "albus@diagon.com" }), { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await resolveAccessToken({
      config: CONFIG,
      email: "albus@diagon.com",
      stateDir: tmpDir,
      fetchFn,
    });

    expect(result.accessToken).toBe("ya29.initial");
  });

  it("throws when no credentials configured", async () => {
    const noCredsConfig: PluginConfig = { services: CONFIG.services };
    await expect(
      resolveAccessToken({ config: noCredsConfig, email: "albus@diagon.com", stateDir: tmpDir }),
    ).rejects.toThrow("No credentials configured");
  });

  it("throws when refresh fails", async () => {
    const fetchFn = (async () =>
      new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof globalThis.fetch;

    await expect(
      resolveAccessToken({
        config: CONFIG,
        email: "albus@diagon.com",
        stateDir: tmpDir,
        fetchFn,
      }),
    ).rejects.toThrow("Token refresh failed");
  });

  it("throws on email verification mismatch after refresh", async () => {
    let callCount = 0;
    const fetchFn = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ access_token: "ya29.bad", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ email: "wrong@other.com" }), { status: 200 });
    }) as typeof globalThis.fetch;

    await expect(
      resolveAccessToken({
        config: CONFIG,
        email: "albus@diagon.com",
        stateDir: tmpDir,
        fetchFn,
      }),
    ).rejects.toThrow("does not belong to the expected account");
  });
});
