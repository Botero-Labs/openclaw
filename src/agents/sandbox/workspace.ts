import syncFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { openBoundaryFile } from "../../infra/boundary-file-read.js";
import { resolveUserPath } from "../../utils.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_COMPANY_FILENAME, // OCT8: digital coworker file (ADR-008)
  DEFAULT_CONTACTS_FILENAME, // OCT8: digital coworker file (ADR-008)
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MANAGER_FILENAME, // OCT8: digital coworker file (ADR-008)
  DEFAULT_ROLE_PROFILE_FILENAME, // OCT8: digital coworker file (ADR-008)
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TEAM_FILENAME, // OCT8: digital coworker file (ADR-008)
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
} from "../workspace.js";

export async function ensureSandboxWorkspace(
  workspaceDir: string,
  seedFrom?: string,
  skipBootstrap?: boolean,
) {
  await fs.mkdir(workspaceDir, { recursive: true });
  if (seedFrom) {
    const seed = resolveUserPath(seedFrom);
    // OCT8: includes oct8 workspace files, order follows ADR-008
    const files = [
      DEFAULT_SOUL_FILENAME,
      DEFAULT_IDENTITY_FILENAME,
      DEFAULT_COMPANY_FILENAME,
      DEFAULT_ROLE_PROFILE_FILENAME,
      DEFAULT_MANAGER_FILENAME,
      DEFAULT_TEAM_FILENAME,
      DEFAULT_USER_FILENAME,
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_TOOLS_FILENAME,
      DEFAULT_CONTACTS_FILENAME,
      DEFAULT_HEARTBEAT_FILENAME,
      DEFAULT_BOOTSTRAP_FILENAME,
    ];
    for (const name of files) {
      const src = path.join(seed, name);
      const dest = path.join(workspaceDir, name);
      try {
        await fs.access(dest);
      } catch {
        try {
          const opened = await openBoundaryFile({
            absolutePath: src,
            rootPath: seed,
            boundaryLabel: "sandbox seed workspace",
          });
          if (!opened.ok) {
            continue;
          }
          try {
            const content = syncFs.readFileSync(opened.fd, "utf-8");
            await fs.writeFile(dest, content, { encoding: "utf-8", flag: "wx" });
          } finally {
            syncFs.closeSync(opened.fd);
          }
        } catch {
          // ignore missing seed file
        }
      }
    }
  }
  await ensureAgentWorkspace({
    dir: workspaceDir,
    ensureBootstrapFiles: !skipBootstrap,
  });
}
