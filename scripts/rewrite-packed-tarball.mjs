#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_PACKAGE_NAME = "@botero-labs/oct8";
const DEFAULT_HOMEPAGE = "https://github.com/Botero-Labs/openclaw#readme";
const DEFAULT_REPOSITORY_URL = "git+https://github.com/Botero-Labs/openclaw.git";
const DEFAULT_BUGS_URL = "https://github.com/Botero-Labs/openclaw/issues";
const DEFAULT_PUBLISH_REGISTRY = "https://npm.pkg.github.com";

function usage() {
  console.error(
    [
      "usage: node scripts/rewrite-packed-tarball.mjs --input <path.tgz> --output <path.tgz>",
      "       [--package-name @botero-labs/oct8]",
      "       [--homepage <url>]",
      "       [--repository-url <git-url>]",
      "       [--bugs-url <url>]",
      "       [--publish-registry <url>]",
    ].join("\n"),
  );
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
  if (result.status === 0) {
    return result;
  }
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const details = [stderr, stdout].filter(Boolean).join("\n");
  throw new Error(`command failed: ${command} ${args.join(" ")}${details ? `\n${details}` : ""}`);
}

function parseArgs(argv) {
  const parsed = {
    input: "",
    output: "",
    packageName: DEFAULT_PACKAGE_NAME,
    homepage: DEFAULT_HOMEPAGE,
    repositoryUrl: DEFAULT_REPOSITORY_URL,
    bugsUrl: DEFAULT_BUGS_URL,
    publishRegistry: DEFAULT_PUBLISH_REGISTRY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      parsed.input = argv[++i] ?? "";
    } else if (arg === "--output") {
      parsed.output = argv[++i] ?? "";
    } else if (arg === "--package-name") {
      parsed.packageName = argv[++i] ?? "";
    } else if (arg === "--homepage") {
      parsed.homepage = argv[++i] ?? "";
    } else if (arg === "--repository-url") {
      parsed.repositoryUrl = argv[++i] ?? "";
    } else if (arg === "--bugs-url") {
      parsed.bugsUrl = argv[++i] ?? "";
    } else if (arg === "--publish-registry") {
      parsed.publishRegistry = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!parsed.input || !parsed.output) {
    usage();
    process.exit(2);
  }

  return parsed;
}

function loadPackageJson(packageJsonPath) {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    throw new Error(
      `failed to parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function rewritePackageManifest(packageJsonPath, options) {
  const packageJson = loadPackageJson(packageJsonPath);
  const repository =
    packageJson.repository && typeof packageJson.repository === "object"
      ? packageJson.repository
      : {};

  packageJson.name = options.packageName;
  packageJson.homepage = options.homepage;
  packageJson.bugs = { url: options.bugsUrl };
  packageJson.repository = {
    ...repository,
    type: "git",
    url: options.repositoryUrl,
  };
  packageJson.publishConfig = {
    ...(packageJson.publishConfig && typeof packageJson.publishConfig === "object"
      ? packageJson.publishConfig
      : {}),
    registry: options.publishRegistry,
  };

  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return packageJson;
}

function ensureFile(filePath, label) {
  try {
    if (!statSync(filePath).isFile()) {
      fail(`${label} is not a file: ${filePath}`);
    }
  } catch {
    fail(`${label} not found: ${filePath}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);

  ensureFile(inputPath, "input tarball");
  mkdirSync(dirname(outputPath), { recursive: true });

  const tempRoot = mkdtempSync(join(tmpdir(), "oct8-rewrite-packed-tarball-"));
  const extractDir = join(tempRoot, "extract");
  mkdirSync(extractDir, { recursive: true });

  try {
    run("tar", ["-xzf", inputPath, "-C", extractDir]);

    const packageJsonPath = join(extractDir, "package", "package.json");
    ensureFile(packageJsonPath, "packed package.json");
    const packageJson = rewritePackageManifest(packageJsonPath, options);

    run("tar", ["-czf", outputPath, "-C", extractDir, "package"]);

    console.error(
      `rewrote ${inputPath} -> ${outputPath} with package name ${packageJson.name}@${packageJson.version}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
