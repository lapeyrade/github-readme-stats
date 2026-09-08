import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import axios from "axios";

// Keep the personal customization outside upstream's core files. The adapter
// supplies the same response shape as commit search, so ranking and rendering
// continue to use the normal upstream pipeline.
/**
 * Install the server-side historical commit adapter.
 * @returns {number} Axios interceptor identifier.
 */
export function installPrivateCommits(client = axios, now = () => new Date()) {
  return client.interceptors.request.use((config) => {
    const url = new URL(config.url, "https://localhost");
    if (
      url.origin !== "https://api.github.com" ||
      url.pathname !== "/search/commits" ||
      url.searchParams.get("q") !== "author:lapeyrade"
    ) {
      return config;
    }

    config.adapter = async () => {
      const date = now();
      const years = Array.from(
        { length: date.getUTCFullYear() - 2008 + 1 },
        (_, index) => index + 2008,
      );
      const fields = years.map((year) => {
        const end =
          year === date.getUTCFullYear()
            ? date.toISOString()
            : `${year}-12-31T23:59:59Z`;
        return `year${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${end}") { totalCommitContributions }`;
      });
      const authorization = config.headers.get("Authorization");
      if (typeof authorization !== "string" || !authorization.trim()) {
        throw new Error("Private commit calculation requires a GitHub token");
      }
      const response = await client.post(
        "https://api.github.com/graphql",
        {
          query: `query PrivateHistoricalCommits($login: String!) { user(login: $login) { ${fields.join("\n")} } }`,
          variables: { login: "lapeyrade" },
        },
        {
          headers: {
            Authorization: authorization.replace(/^token\s+/i, "Bearer "),
          },
          timeout: 25000,
        },
      );
      const user = response.data.data?.user;
      if (response.data.errors?.length || !user) {
        throw new Error("GitHub could not return the complete commit history");
      }
      let total = 0;
      for (const year of years) {
        const count = user[`year${year}`]?.totalCommitContributions;
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new Error(`GitHub returned incomplete commit data for ${year}`);
        }
        total += count;
      }
      return {
        data: { total_count: total, incomplete_results: false, items: [] },
        status: 200,
        statusText: "OK",
        headers: response.headers,
        config,
      };
    };
    return config;
  });
}

// The frontend also imports the router for its demo. Only install on Node.
if (globalThis.process?.versions?.node) {
  installPrivateCommits();
  // Vercel packages core separately, which may have its own Axios instance.
  const coreRequire = createRequire(
    import.meta.resolve("@stats-organization/github-readme-stats-core"),
  );
  const { default: coreAxios } = await import(
    new URL(
      "./index.js",
      pathToFileURL(coreRequire.resolve("axios/package.json")),
    ).href
  );
  if (coreAxios !== axios) {
    installPrivateCommits(coreAxios);
  }
}
