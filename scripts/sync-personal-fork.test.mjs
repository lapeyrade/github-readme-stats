import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  applyTrackedChanges,
  git,
  prepareSync,
} from "./sync-personal-fork.mjs";

const repos = [];
afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});
const write = (repo, file, content) => {
  const target = path.join(repo, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};
const commit = (repo, message) => {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
};
/**
 * @returns {object} An isolated repository with upstream and production refs.
 */
function fixture() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "stats-sync-"));
  repos.push(repo);
  git(repo, ["init", "-b", "release"]);
  git(repo, ["config", "user.name", "Sync test"]);
  git(repo, ["config", "user.email", "sync@example.invalid"]);
  write(repo, "packages/core/version.txt", "2.2\n");
  write(repo, "apps/backend/app.js", "export const app = {};\n");
  write(repo, "apps/backend/router.js", "export default {};\n");
  write(repo, ".github/workflows/upstream.yml", "old workflow\n");
  const base = commit(repo, "upstream base");
  git(repo, ["branch", "upstream/release"]);
  write(repo, "apps/backend/src/private-commits.js", "personal adapter\n");
  write(repo, ".github/workflows/personal.yml", "personal workflow\n");
  write(repo, ".upstream-release-sha", base + "\n");
  const personal = commit(repo, "personal overlay");
  git(repo, ["branch", "master"]);
  git(repo, ["switch", "master"]);
  write(repo, ".synced-release-sha", personal + "\n");
  commit(repo, "initial production mirror");
  git(repo, ["update-ref", "refs/remotes/origin/master", "HEAD"]);
  git(repo, ["switch", "release"]);
  return { repo, base, personal };
}
/**
 * @returns {string} The next upstream commit, leaving release checked out.
 */
function upstream(repo, edit) {
  git(repo, ["switch", "upstream/release"]);
  edit();
  const sha = commit(repo, "next upstream");
  git(repo, ["switch", "release"]);
  return sha;
}

test("updates both branches, preserves the overlay and workflows, and is idempotent", () => {
  const { repo } = fixture();
  const target = upstream(repo, () => {
    write(repo, "packages/core/version.txt", "2.3\n");
    write(repo, ".github/workflows/upstream.yml", "new upstream workflow\n");
  });
  const result = prepareSync(repo);
  assert.equal(result.changed, true);
  assert.equal(
    readFileSync(path.join(repo, "packages/core/version.txt"), "utf8"),
    "2.3\n",
  );
  assert.equal(
    readFileSync(
      path.join(repo, "apps/backend/src/private-commits.js"),
      "utf8",
    ),
    "personal adapter\n",
  );
  assert.equal(
    readFileSync(path.join(repo, ".github/workflows/upstream.yml"), "utf8"),
    "old workflow\n",
  );
  assert.equal(
    readFileSync(path.join(repo, ".upstream-release-sha"), "utf8").trim(),
    target,
  );
  assert.equal(git(repo, ["status", "--porcelain"]), "");
  git(repo, ["update-ref", "refs/remotes/origin/master", result.master]);
  git(repo, ["switch", "release"]);
  const again = prepareSync(repo);
  assert.equal(again.changed, false);
  assert.equal(again.release, result.release);
  assert.equal(again.master, result.master);
});

test("handles upstream deletions and renames", () => {
  const { repo } = fixture();
  upstream(repo, () => {
    git(repo, ["mv", "packages/core/version.txt", "packages/core/release.txt"]);
    git(repo, ["rm", "apps/backend/router.js"]);
  });
  assert.equal(
    applyTrackedChanges(
      repo,
      "upstream/release",
      ".upstream-release-sha",
      "sync",
    ),
    true,
  );
  assert.equal(git(repo, ["ls-files", "apps/backend/router.js"]), "");
  assert.equal(
    readFileSync(path.join(repo, "packages/core/release.txt"), "utf8"),
    "2.2\n",
  );
});

test("records workflow-only upstream releases without importing workflow files", () => {
  const { repo } = fixture();
  const target = upstream(repo, () =>
    write(repo, ".github/workflows/new.yml", "unreviewed workflow\n"),
  );
  applyTrackedChanges(
    repo,
    "upstream/release",
    ".upstream-release-sha",
    "checkpoint",
  );
  assert.equal(git(repo, ["ls-files", ".github/workflows/new.yml"]), "");
  assert.equal(
    readFileSync(path.join(repo, ".upstream-release-sha"), "utf8").trim(),
    target,
  );
});

test("preserves binary patches and blank context lines exactly", () => {
  const { repo } = fixture();
  write(repo, "text.txt", "first\n\n");
  const base = commit(repo, "blank context");
  write(repo, ".upstream-release-sha", base + "\n");
  commit(repo, "new checkpoint");
  git(repo, ["update-ref", "refs/heads/upstream/release", base]);
  upstream(repo, () => {
    write(repo, "text.txt", "first\nsecond\n\n");
    write(repo, "image.bin", Buffer.from([0, 255, 1, 2]));
  });
  applyTrackedChanges(
    repo,
    "upstream/release",
    ".upstream-release-sha",
    "binary sync",
  );
  assert.equal(
    readFileSync(path.join(repo, "text.txt"), "utf8"),
    "first\nsecond\n\n",
  );
  assert.deepEqual(
    readFileSync(path.join(repo, "image.bin")),
    Buffer.from([0, 255, 1, 2]),
  );
});

test("fails on a code conflict without advancing the branch or checkpoint", () => {
  const { repo, base } = fixture();
  write(repo, "packages/core/version.txt", "local incompatible change\n");
  const head = commit(repo, "local change");
  upstream(repo, () =>
    write(repo, "packages/core/version.txt", "different upstream change\n"),
  );
  assert.throws(() =>
    applyTrackedChanges(
      repo,
      "upstream/release",
      ".upstream-release-sha",
      "sync",
    ),
  );
  assert.equal(git(repo, ["rev-parse", "HEAD"]), head);
  assert.equal(
    readFileSync(path.join(repo, ".upstream-release-sha"), "utf8").trim(),
    base,
  );
});

test("refuses dirty working trees and invalid checkpoints", () => {
  const { repo } = fixture();
  write(repo, "uncommitted.txt", "user work\n");
  assert.throws(() => prepareSync(repo), /clean checkout/);
  commit(repo, "user work");
  write(repo, ".upstream-release-sha", "not-a-commit\n");
  commit(repo, "bad checkpoint");
  assert.throws(() => prepareSync(repo), /Invalid sync checkpoint/);
});

test("rejects rewritten upstream history", () => {
  const { repo } = fixture();
  upstream(repo, () => write(repo, "packages/core/version.txt", "2.3\n"));
  applyTrackedChanges(
    repo,
    "upstream/release",
    ".upstream-release-sha",
    "sync",
  );
  git(repo, [
    "update-ref",
    "refs/heads/upstream/release",
    "upstream/release~1",
  ]);
  assert.throws(() => prepareSync(repo), /merge-base failed/);
});

test("does not publish when the production mirror has a conflicting edit", () => {
  const { repo } = fixture();
  git(repo, ["switch", "master"]);
  write(repo, "packages/core/version.txt", "production-only edit\n");
  const master = commit(repo, "production edit");
  git(repo, ["update-ref", "refs/remotes/origin/master", master]);
  git(repo, ["switch", "release"]);
  upstream(repo, () => write(repo, "packages/core/version.txt", "2.3\n"));
  assert.throws(() => prepareSync(repo), /apply failed/);
  assert.equal(git(repo, ["rev-parse", "refs/remotes/origin/master"]), master);
  assert.equal(git(repo, ["rev-parse", "master"]), master);
});
