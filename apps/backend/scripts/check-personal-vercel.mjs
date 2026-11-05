import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(root, "apps/backend/.vercel/output");
const functionPath = path.join(output, "functions/api.func");
const require = createRequire(path.join(root, "apps/backend/package.json"));
const { default: nock } = await import(pathToFileURL(require.resolve("nock")));
nock.disableNetConnect();
nock.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
process.env.PAT_1 = "packaged-test-token";
delete process.env.POSTGRES_URL;
const user = {
  name: "Sylvain",
  login: "lapeyrade",
  commits: { totalCommitContributions: 963 },
  reviews: { totalPullRequestReviewContributions: 20 },
  repositoriesContributedTo: { totalCount: 90 },
  contributionsCollection: { contributionYears: [2025, 2026] },
  pullRequests: { totalCount: 73 },
  openIssues: { totalCount: 10 },
  closedIssues: { totalCount: 13 },
  followers: { totalCount: 30 },
  repositories: {
    totalCount: 1,
    nodes: [{ name: "thesis", stargazerCount: 41 }],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};
const years = Object.fromEntries(
  Array.from({ length: new Date().getUTCFullYear() - 2008 + 1 }, (_, i) => [
    `year${2008 + i}`,
    { totalCommitContributions: i === 0 ? 963 : i === 1 ? 2000 : 0 },
  ]),
);
let historicalRequests = 0;
nock("https://api.github.com")
  .persist()
  .post("/graphql")
  .reply(200, async (request) => {
    const body = await request.json();
    if (body.query.includes("PrivateHistoricalCommits")) {
      historicalRequests++;
      return { data: { user: years } };
    }
    return { data: { user } };
  });
const config = JSON.parse(
  await readFile(path.join(output, "config.json"), "utf8"),
);
const functionConfig = JSON.parse(
  await readFile(path.join(functionPath, ".vc-config.json"), "utf8"),
);
assert.equal(config.version, 3);
assert.equal(functionConfig.runtime, "nodejs24.x");
assert.equal(functionConfig.handler, "vercel-handler.js");
assert(config.routes.some((route) => route.dest === "/api"));
await readFile(path.join(output, "static/frontend/docs/index.html"));
const { default: app } = await import(
  pathToFileURL(path.join(functionPath, functionConfig.handler))
);
const server = app.listen(0, "127.0.0.1");
try {
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const redirect = await fetch(base, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/frontend/docs/");
  const response = await fetch(
    `${base}/api/?username=lapeyrade&include_all_commits=true&number_format=long`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
  const card = await response.text();
  assert(card.includes("Total Commits  : 2963"));
  assert(card.includes("Total PRs: 73"));
  assert.equal(historicalRequests, 1);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  console.log(
    "Packaged Vercel function, historical commits, routing and static docs verified without live network access.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  nock.cleanAll();
}
