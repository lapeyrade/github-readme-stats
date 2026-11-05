import { api } from "@stats-organization/github-readme-stats-core";
import axios from "axios";
import nock from "nock";
import supertest from "supertest";
import { expect, it } from "vitest";

import app from "../vercel-handler.js";

/**
 * @returns {object} Complete synthetic yearly commit counts.
 */
function history() {
  return Object.fromEntries(
    Array.from({ length: new Date().getUTCFullYear() - 2008 + 1 }, (_, i) => [
      `year${2008 + i}`,
      { totalCommitContributions: i === 0 ? 963 : i === 1 ? 2000 : 0 },
    ]),
  );
}

/**
 * @returns {Array<string>} GraphQL queries received by the mock.
 */
function mockGitHub(years = history(), errors) {
  const queries = [];
  nock("https://api.github.com")
    .persist()
    .post("/graphql")
    .reply(200, async (request) => {
      const { query } = await request.json();
      queries.push(query);
      if (query.includes("PrivateHistoricalCommits")) {
        return { data: { user: years }, errors };
      }
      return {
        data: {
          user: {
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
          },
        },
      };
    });
  return queries;
}

it("keeps historical commits and separate PR/issue metrics through upstream's actual card API", async () => {
  const queries = mockGitHub();
  const card = await api(
    { username: "lapeyrade", include_all_commits: "true" },
    "test-token",
  );
  expect(card.status).toBe("success");
  expect(card.content).toContain("2963");
  expect(card.content).toContain("Total PRs: 73");
  expect(card.content).toContain("Total Issues: 23");
  expect(
    queries.some((query) => query.includes("PrivateHistoricalCommits")),
  ).toBe(true);
});

it("loads the adapter through the actual Vercel Express entrypoint", async () => {
  mockGitHub();
  const response = await supertest(app)
    .get("/api/?username=lapeyrade&include_all_commits=true&number_format=long")
    .expect("Content-Type", "image/svg+xml")
    .expect(200);
  expect(response.body.toString()).toContain("Total Commits  : 2963");
  expect(response.body.toString()).toContain("Total PRs: 73");
});

it("rejects a missing year instead of silently publishing a smaller count", async () => {
  const years = history();
  delete years.year2018;
  mockGitHub(years);
  const card = await api(
    { username: "lapeyrade", include_all_commits: "true" },
    "test-token",
  );
  expect(card.status).toBe("error - temporary");
});

it("rejects partial GraphQL responses", async () => {
  mockGitHub(history(), [{ message: "partial GraphQL response" }]);
  const card = await api(
    { username: "lapeyrade", include_all_commits: "true" },
    "test-token",
  );
  expect(card.status).toBe("error - temporary");
});

it("preserves scoped searches and other profiles", async () => {
  const search = nock("https://api.github.com")
    .get("/search/commits")
    .query(true)
    .times(2)
    .reply(200, { total_count: 7 });
  for (const query of [
    "author:someone",
    "repo:lapeyrade/thesis author:lapeyrade",
  ]) {
    const response = await axios.get(
      `https://api.github.com/search/commits?q=${encodeURIComponent(query)}`,
    );
    expect(response.data.total_count).toBe(7);
  }
  expect(search.isDone()).toBe(true);
});

it.each([null, -1, 1.5])(
  "rejects invalid yearly commit counts (%s)",
  async (invalid) => {
    const years = history();
    years.year2018 = { totalCommitContributions: invalid };
    mockGitHub(years);
    const card = await api(
      { username: "lapeyrade", include_all_commits: "true" },
      "test-token",
    );
    expect(card.status).toBe("error - temporary");
  },
);

it("does not replace the normal recent-commits option", async () => {
  const queries = mockGitHub();
  const card = await api(
    { username: "lapeyrade", number_format: "long" },
    "test-token",
  );
  expect(card.status).toBe("success");
  expect(card.content).toContain("963");
  expect(
    queries.some((query) => query.includes("PrivateHistoricalCommits")),
  ).toBe(false);
});
