import path from "node:path";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "openclaw/plugin-sdk/json-store";

/** Cached OAuth token stored on the agent machine. */
export type StoredToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  scopes: string[];
};

const TOKENS_DIR = "oct8-google-workspace/tokens";

function tokenPath(stateDir: string, profileId: string): string {
  // Sanitize profileId for filesystem — replace colons with dashes
  const safeName = profileId.replace(/:/g, "-");
  return path.join(stateDir, TOKENS_DIR, `${safeName}.json`);
}

/** Load a stored token for the given auth profile ID. Returns null if not found or corrupted. */
export async function loadToken(stateDir: string, profileId: string): Promise<StoredToken | null> {
  const filePath = tokenPath(stateDir, profileId);
  const { value, exists } = await readJsonFileWithFallback<StoredToken | null>(filePath, null);
  if (!exists || !value) {
    return null;
  }
  // Basic shape validation
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.expiresAt !== "number" ||
    typeof value.email !== "string"
  ) {
    return null;
  }
  return value;
}

/** Save a token for the given auth profile ID. File is written atomically with 0o600 permissions. */
export async function saveToken(
  stateDir: string,
  profileId: string,
  token: StoredToken,
): Promise<void> {
  const filePath = tokenPath(stateDir, profileId);
  await writeJsonFileAtomically(filePath, token);
}

/** Delete a stored token. */
export async function deleteToken(stateDir: string, profileId: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const filePath = tokenPath(stateDir, profileId);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
