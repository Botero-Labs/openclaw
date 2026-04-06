import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("diagnostics.oct8 config", () => {
  it("accepts a valid diagnostics.oct8 configuration", () => {
    const result = OpenClawSchema.safeParse({
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
          flushIntervalMs: 1_000,
          maxBatchSize: 100,
          maxQueueSize: 1_000,
          requestTimeoutMs: 5_000,
          retryBaseMs: 1_000,
          retryMaxMs: 30_000,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects maxQueueSize values smaller than maxBatchSize", () => {
    const result = OpenClawSchema.safeParse({
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
          maxBatchSize: 100,
          maxQueueSize: 99,
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["diagnostics", "oct8", "maxQueueSize"],
        }),
      ]),
    );
  });

  it("rejects retryMaxMs values smaller than retryBaseMs", () => {
    const result = OpenClawSchema.safeParse({
      diagnostics: {
        enabled: true,
        oct8: {
          enabled: true,
          baseUrl: "https://oct8.example.com",
          orgId: "11111111-1111-4111-8111-111111111111",
          coworkerId: "22222222-2222-4222-8222-222222222222",
          gatewayId: "33333333-3333-4333-8333-333333333333",
          deploymentTargetId: "44444444-4444-4444-8444-444444444444",
          retryBaseMs: 2_000,
          retryMaxMs: 1_000,
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["diagnostics", "oct8", "retryMaxMs"],
        }),
      ]),
    );
  });
});
