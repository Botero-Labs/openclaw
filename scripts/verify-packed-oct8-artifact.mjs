#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInstalledWorkspaceBootstrapSmoke } from "./lib/workspace-bootstrap-smoke.mjs";

const REQUIRED_PLUGIN_MANIFEST = join(
  "dist",
  "extensions",
  "oct8-google-workspace",
  "openclaw.plugin.json",
);
const REQUIRED_COWORKER_BOOTSTRAP_FILES = [
  "COMPANY.md",
  "ROLE_PROFILE.md",
  "MANAGER.md",
  "TEAM.md",
  "CONTACTS.md",
];
const REQUIRED_HEARTBEAT_MARKERS = [
  "# HEARTBEAT.md",
  "<!-- Keep this file empty to skip heartbeat API calls. -->",
  "<!-- Add tasks below when you want to check something periodically. -->",
];

function usage() {
  console.error("usage: node scripts/verify-packed-oct8-artifact.mjs --tarball <path.tgz>");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  let tarball = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tarball") {
      tarball = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!tarball) {
    usage();
    process.exit(2);
  }
  return { tarball: resolve(tarball) };
}

function installTarball(prefixDir, tarballPath) {
  execFileSync(
    "npm",
    ["install", "-g", "--prefix", prefixDir, "--no-audit", "--no-fund", tarballPath],
    {
      encoding: "utf8",
      stdio: "inherit",
    },
  );
}

function resolveGlobalRoot(prefixDir) {
  return execFileSync("npm", ["root", "-g", "--prefix", prefixDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function verifyPluginManifest(packageRoot) {
  const pluginManifest = join(packageRoot, REQUIRED_PLUGIN_MANIFEST);
  if (!existsSync(pluginManifest)) {
    fail(`missing packaged plugin manifest: ${pluginManifest}`);
  }
}

function verifyInstalledVersion(prefixDir) {
  const version = execFileSync(join(prefixDir, "bin", "openclaw"), ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${join(prefixDir, "bin")}:${process.env.PATH ?? ""}`,
    },
  }).trim();
  if (!version.includes("OpenClaw")) {
    fail(`unexpected version output: ${version}`);
  }
  return version;
}

function verifyHeartbeatTemplate(packageRoot) {
  const tempRoot = mkdtempSync(join(tmpdir(), "oct8-packed-artifact-heartbeat-"));
  const homeDir = join(tempRoot, "home");
  const cwdDir = join(tempRoot, "cwd");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwdDir, { recursive: true });

  try {
    try {
      execFileSync(
        process.execPath,
        [
          join(packageRoot, "openclaw.mjs"),
          "agent",
          "--message",
          "workspace bootstrap smoke",
          "--session-id",
          "workspace-bootstrap-smoke",
          "--local",
          "--timeout",
          "1",
          "--json",
        ],
        {
          cwd: cwdDir,
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 16,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            HOME: homeDir,
            OPENCLAW_HOME: homeDir,
            OPENCLAW_SUPPRESS_NOTES: "1",
          },
        },
      );
    } catch {
      // The smoke only needs workspace seeding; model/runtime failures after bootstrap are acceptable here.
    }

    const heartbeatPath = join(homeDir, ".openclaw", "workspace", "HEARTBEAT.md");
    const heartbeat = readFileSync(heartbeatPath, "utf8");
    for (const marker of REQUIRED_HEARTBEAT_MARKERS) {
      if (!heartbeat.includes(marker)) {
        fail(`installed heartbeat template missing marker: ${marker}`);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const { tarball } = parseArgs(process.argv.slice(2));
  if (!existsSync(tarball)) {
    fail(`tarball not found: ${tarball}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "oct8-packed-artifact-"));
  const prefixDir = join(tempRoot, "prefix");

  try {
    installTarball(prefixDir, tarball);
    const packageRoot = join(resolveGlobalRoot(prefixDir), "@botero-labs", "oct8");
    if (!existsSync(packageRoot)) {
      fail(`installed package root not found: ${packageRoot}`);
    }

    const version = verifyInstalledVersion(prefixDir);
    verifyPluginManifest(packageRoot);
    runInstalledWorkspaceBootstrapSmoke({ packageRoot });
    verifyHeartbeatTemplate(packageRoot);

    console.log(
      JSON.stringify(
        {
          packageRoot,
          version,
          pluginManifest: REQUIRED_PLUGIN_MANIFEST,
          coworkerBootstrapFiles: REQUIRED_COWORKER_BOOTSTRAP_FILES,
          heartbeatTemplate: "oct8",
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
