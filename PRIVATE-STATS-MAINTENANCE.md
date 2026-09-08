# Personal stats fork

`release` follows `stats-organization/github-stats-extended:release` daily.
`master` is the Vercel production branch. The sync workflow merges locally,
builds core, runs all unit tests (including the real card integration test),
builds the frontend, and only then pushes both branches atomically.

Keep `packages/core` identical to upstream. The personal historical commit
calculation lives in `apps/backend/src/private-commits.js`, loaded by the
backend router. It adapts only the unfiltered `author:lapeyrade` commit search
to GitHub's yearly `totalCommitContributions`. Scoped searches retain upstream
behavior. Missing years and GraphQL errors are rejected rather than presented
as complete totals. PRs, issues, ranking and rendering use upstream code.

The adapter covers the separate Axios copy in Vercel's production package and
does not activate in the browser demo. Its integration test calls the actual
upstream card API, so a change in the core request path cannot silently remove
the historical count while the sync job stays green.

Future incompatible upstream changes can still fail validation or conflict
with the backend/deployment configuration. The job deliberately stops before
publishing in that situation; investigate the failure rather than forcing a
merge or overwriting the customization.
