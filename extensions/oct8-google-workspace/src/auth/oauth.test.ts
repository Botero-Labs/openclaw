import { describe, expect, it } from "vitest";
import { TOKEN_REFRESH_SKEW_SECONDS } from "../constants.js";
import { isTokenExpiringSoon, refreshAccessToken, verifyTokenEmail } from "./oauth.js";
import type { StoredToken } from "./token-store.js";

function mockFetch(impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return impl as typeof globalThis.fetch;
}

function respondJson(data: unknown, status = 200) {
  return mockFetch(async () => new Response(JSON.stringify(data), { status }));
}

function respondError(body: string, status: number) {
  return mockFetch(async () => new Response(body, { status }));
}

describe("refreshAccessToken", () => {
  it("returns new access token on success", async () => {
    const result = await refreshAccessToken({
      email: "a@b.com",
      refreshToken: "refresh-123",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchFn: respondJson({ access_token: "new-access-token", expires_in: 3600 }),
    });

    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("refresh-123");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("uses rotated refresh token when Google provides one", async () => {
    const result = await refreshAccessToken({
      email: "a@b.com",
      refreshToken: "old-refresh",
      clientId: "cid",
      clientSecret: "csec",
      fetchFn: respondJson({
        access_token: "new",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }),
    });

    expect(result.refreshToken).toBe("rotated-refresh");
  });

  it("throws on 401 response", async () => {
    await expect(
      refreshAccessToken({
        email: "a@b.com",
        refreshToken: "bad-refresh",
        clientId: "cid",
        clientSecret: "csec",
        fetchFn: respondError('{"error":"invalid_grant"}', 401),
      }),
    ).rejects.toThrow("Token refresh failed (401)");
  });

  it("serializes concurrent refreshes for the same email", async () => {
    let callCount = 0;
    const fn = mockFetch(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({ access_token: `token-${callCount}`, expires_in: 3600 }),
        { status: 200 },
      );
    });

    const params = {
      email: "same@b.com",
      refreshToken: "r",
      clientId: "c",
      clientSecret: "s",
      fetchFn: fn,
    };

    const [r1, r2] = await Promise.all([refreshAccessToken(params), refreshAccessToken(params)]);

    expect(r1.accessToken).toBe("token-1");
    expect(r2.accessToken).toBe("token-2");
    expect(callCount).toBe(2);
  });

  it("allows concurrent refreshes for different emails", async () => {
    let callCount = 0;
    const fn = mockFetch(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
      });
    });

    await Promise.all([
      refreshAccessToken({
        email: "a@b.com",
        refreshToken: "r1",
        clientId: "c",
        clientSecret: "s",
        fetchFn: fn,
      }),
      refreshAccessToken({
        email: "x@y.com",
        refreshToken: "r2",
        clientId: "c",
        clientSecret: "s",
        fetchFn: fn,
      }),
    ]);

    expect(callCount).toBe(2);
  });
});

describe("verifyTokenEmail", () => {
  it("passes when email matches", async () => {
    await expect(
      verifyTokenEmail("token", "albus@diagon.com", respondJson({ email: "albus@diagon.com" })),
    ).resolves.toBeUndefined();
  });

  it("passes with case-insensitive comparison", async () => {
    await expect(
      verifyTokenEmail("token", "albus@diagon.com", respondJson({ email: "Albus@Diagon.com" })),
    ).resolves.toBeUndefined();
  });

  it("throws on email mismatch", async () => {
    await expect(
      verifyTokenEmail("token", "albus@diagon.com", respondJson({ email: "wrong@other.com" })),
    ).rejects.toThrow("does not belong to the expected account");
  });

  it("throws on failed userinfo request", async () => {
    await expect(verifyTokenEmail("token", "a@b.com", respondError("", 401))).rejects.toThrow(
      "Email verification failed",
    );
  });
});

describe("isTokenExpiringSoon", () => {
  it("returns false for token expiring far in the future", () => {
    const token: StoredToken = {
      accessToken: "t",
      refreshToken: "r",
      expiresAt: Date.now() + 3600 * 1000,
      email: "a@b.com",
      scopes: [],
    };
    expect(isTokenExpiringSoon(token)).toBe(false);
  });

  it("returns true for token within the skew window", () => {
    const token: StoredToken = {
      accessToken: "t",
      refreshToken: "r",
      expiresAt: Date.now() + (TOKEN_REFRESH_SKEW_SECONDS - 10) * 1000,
      email: "a@b.com",
      scopes: [],
    };
    expect(isTokenExpiringSoon(token)).toBe(true);
  });

  it("returns true for already expired token", () => {
    const token: StoredToken = {
      accessToken: "t",
      refreshToken: "r",
      expiresAt: Date.now() - 1000,
      email: "a@b.com",
      scopes: [],
    };
    expect(isTokenExpiringSoon(token)).toBe(true);
  });
});
