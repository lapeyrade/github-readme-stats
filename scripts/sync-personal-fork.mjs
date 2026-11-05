import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const git = (cwd, args, input, raw = false) => {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return raw ? result.stdout : result.stdout.trimEnd();
};

const paths = [
  ".",
  ":(exclude).github/workflows/**",
  ":(exclude).synced-release-sha",
];

/**
 * @returns {boolean} Whether a checkpoint commit was created.
 */
export function applyTrackedChanges(cwd, sourceRef, marker, message) {
  if (git(cwd, ["status", "--porcelain"])) {
    throw new Error("Sync requires a clean checkout");
  }
  const source = git(cwd, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  const markerPath = path.join(cwd, marker);
  const previous = existsSync(markerPath)
    ? readFileSync(markerPath, "utf8").trim()
    : git(cwd, ["merge-base", "HEAD", source]);
  if (!/^[0-9a-f]{40}$/.test(previous)) {
    throw new Error("Invalid sync checkpoint");
  }
  git(cwd, ["merge-base", "--is-ancestor", previous, source]);
  if (previous === source) {
    return false;
  }

  const patch = git(
    cwd,
    ["diff", "--no-ext-diff", "--binary", previous, source, "--", ...paths],
    undefined,
    true,
  );
  if (patch) {
    git(cwd, ["apply", "--3way", "--index", "--whitespace=nowarn"], patch);
  }
  writeFileSync(markerPath, source + "\n");
  git(cwd, ["add", "--", marker]);
  git(cwd, ["commit", "-m", message]);
  return true;
}

/**
 * @returns {object} Validated candidate commits and original remote heads.
 */
export function prepareSync(cwd) {
  if (git(cwd, ["branch", "--show-current"]) !== "release") {
    throw new Error("Start sync on release");
  }
  const releaseBase = git(cwd, ["rev-parse", "HEAD"]);
  const masterBase = git(cwd, ["rev-parse", "origin/master"]);
  const upstreamChanged = applyTrackedChanges(
    cwd,
    "upstream/release",
    ".upstream-release-sha",
    "Sync validated upstream application changes",
  );
  const release = git(cwd, ["rev-parse", "release"]);
  git(cwd, [
    "diff",
    "--exit-code",
    "upstream/release",
    "--",
    "packages/core",
    "apps/backend/router.js",
    "apps/backend/app.js",
  ]);
  git(cwd, ["switch", "--force-create", "master", "origin/master"]);
  const masterChanged = applyTrackedChanges(
    cwd,
    "release",
    ".synced-release-sha",
    "Publish validated personal release",
  );
  git(cwd, ["diff", "--exit-code", "release", "--", ...paths]);
  return {
    changed: upstreamChanged || masterChanged,
    release,
    master: git(cwd, ["rev-parse", "master"]),
    release_base: releaseBase,
    master_base: masterBase,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = prepareSync(process.cwd());
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
  console.log(JSON.stringify(result));
}
