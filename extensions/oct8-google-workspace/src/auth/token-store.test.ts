import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteToken, loadToken, saveToken, type StoredToken } from "./token-store.js";

const VALID_TOKEN: StoredToken = {
  accessToken: "ya29.access-token-123",
  refreshToken: "1//refresh-token-456",
  expiresAt: Date.now() + 3600 * 1000,
  email: "albus@diagon.com",
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oct8-gws-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("token-store", () => {
  const profileId = "gws:albus@diagon.com";

  it("save and load round-trip returns same data", async () => {
    await saveToken(tmpDir, profileId, VALID_TOKEN);
    const loaded = await loadToken(tmpDir, profileId);
    expect(loaded).toEqual(VALID_TOKEN);
  });

  it("load returns null for nonexistent profile", async () => {
    const loaded = await loadToken(tmpDir, "nonexistent-profile");
    expect(loaded).toBeNull();
  });

  it("load returns null for corrupted token file", async () => {
    const safeName = profileId.replace(/:/g, "-");
    const tokenDir = path.join(tmpDir, "oct8-google-workspace/tokens");
    await fs.mkdir(tokenDir, { recursive: true });
    await fs.writeFile(path.join(tokenDir, `${safeName}.json`), "not json{{{", "utf-8");

    const loaded = await loadToken(tmpDir, profileId);
    expect(loaded).toBeNull();
  });

  it("load returns null for token missing required fields", async () => {
    const safeName = profileId.replace(/:/g, "-");
    const tokenDir = path.join(tmpDir, "oct8-google-workspace/tokens");
    await fs.mkdir(tokenDir, { recursive: true });
    await fs.writeFile(
      path.join(tokenDir, `${safeName}.json`),
      JSON.stringify({ accessToken: "yes" }), // missing other fields
      "utf-8",
    );

    const loaded = await loadToken(tmpDir, profileId);
    expect(loaded).toBeNull();
  });

  it("delete removes the token file", async () => {
    await saveToken(tmpDir, profileId, VALID_TOKEN);
    await deleteToken(tmpDir, profileId);
    const loaded = await loadToken(tmpDir, profileId);
    expect(loaded).toBeNull();
  });

  it("delete does not throw for nonexistent file", async () => {
    await expect(deleteToken(tmpDir, "nonexistent")).resolves.toBeUndefined();
  });
});
