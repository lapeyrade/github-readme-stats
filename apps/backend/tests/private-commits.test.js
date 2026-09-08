import { api } from "@stats-organization/github-readme-stats-core";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, expect, it } from "vitest";

import "../src/private-commits.js";

const mock = new MockAdapter(axios);
afterEach(() => mock.reset());

/**
 *
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
 *
 */
function mockGitHub(years = history(), errors) {
  mock.onPost("https://api.github.com/graphql").reply((config) => {
    const { query } = JSON.parse(config.data);
    if (query.includes("PrivateHistoricalCommits")) {
      return [200, { data: { user: years }, errors }];
    }
    return [
      200,
      {
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
      },
    ];
  });
}

it("keeps historical commits and separate PR/issue metrics through upstream's actual card API", async () => {
  mockGitHub();
  const card = await api(
    { username: "lapeyrade", include_all_commits: "true" },
    "test-token",
  );
  expect(card.status).toBe("success");
  expect(card.content).toContain("2963");
  expect(card.content).toContain("Total PRs: 73");
  expect(card.content).toContain("Total Issues: 23");
  expect(mock.history.get).toHaveLength(0);
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
  mockGitHub(history(), [{ message: "rate limit" }]);
  const card = await api(
    { username: "lapeyrade", include_all_commits: "true" },
    "test-token",
  );
  expect(card.status).toBe("error - temporary");
});

it("preserves scoped searches and other profiles", async () => {
  mock.onGet().reply(200, { total_count: 7 });
  for (const query of [
    "author:someone",
    "repo:lapeyrade/thesis author:lapeyrade",
  ]) {
    const response = await axios.get(
      `https://api.github.com/search/commits?q=${encodeURIComponent(query)}`,
    );
    expect(response.data.total_count).toBe(7);
  }
  expect(mock.history.post).toHaveLength(0);
});
