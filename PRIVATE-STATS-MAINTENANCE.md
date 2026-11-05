# Personal stats fork

`release` follows `stats-organization/github-stats-extended:release` daily.
`master` is the Vercel production branch. The sync workflow prepares both
branches locally, builds core, runs all unit tests (including the real card
integration test), builds the frontend and checks the packaged Vercel function.
A separate job then pushes both validated branches atomically. Dependency
installation and tests have read-only repository permissions; only that
isolated publishing job has write access. No personal token is required.

Keep `packages/core` identical to upstream. The personal historical commit
calculation lives in `apps/backend/src/private-commits.js`, loaded only by
`apps/backend/vercel-handler.js`. The upstream router and Express application
remain unchanged. It adapts only the unfiltered `author:lapeyrade` commit search
to GitHub's yearly `totalCommitContributions`. Scoped searches retain upstream
behavior. Missing years and GraphQL errors are rejected rather than presented
as complete totals. PRs, issues, ranking and rendering use upstream code.

The adapter covers the separate Axios copy in Vercel's production package and
does not activate in the browser demo. Its integration test calls the actual
upstream card API, so a change in the core request path cannot silently remove
the historical count while the sync job stays green.

## Sync checkpoints and validation

`scripts/sync-personal-fork.mjs` applies upstream deltas using Git's three-way
patch support, excluding `.github/workflows/**`. This keeps upstream workflow
changes from requiring extra write permissions or importing unrelated jobs.
`.upstream-release-sha` records the upstream source commit, and
`.synced-release-sha` on `master` records the personal release already copied.
The fork's GitHub ahead/behind count is not a reliable indication of freshness
because the application changes are applied as patches, not merge commits.

An unchanged scheduled sync skips installation and rebuilding. Dispatch the
workflow manually to force all checks even when no source changes are pending.
The publisher rejects concurrent branch updates and never force-pushes.

## Vercel 2.3 deployment

`scripts/build-personal-vercel.mjs` generates the documented Build Output API:
an Express function on Node.js 24 and frontend files served by Vercel's CDN.
It no longer depends on upstream's deleted `_dot_vercel_copy` templates or
`vercel-preparation.sh`, and does not require a container or a paid plan.
`apps/backend/scripts/check-personal-vercel.mjs` runs the actual packaged function with a
dummy token and blocked external networking, checking the historical count,
query parameters, trailing slashes, redirects and static documentation.

Local checks (Node.js 24 and the pnpm version in `package.json`):

```sh
node --test scripts/sync-personal-fork.test.mjs
pnpm run build:packages
pnpm exec vitest run
node scripts/build-personal-vercel.mjs
node apps/backend/scripts/check-personal-vercel.mjs
```

Future incompatible upstream changes can still fail validation. The job
deliberately stops before publishing in that situation; investigate the
failure rather than forcing a merge or overwriting the customization.
