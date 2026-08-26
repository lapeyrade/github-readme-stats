#!/bin/bash

set -euo pipefail

rm -rf ./apps/deployment ./apps/core-deployment ./apps/backend/node_modules

pnpm run build:packages
pnpm --filter ./apps/backend/ --legacy --prod deploy ./apps/deployment/
pnpm --filter @stats-organization/github-readme-stats-core --legacy --prod deploy ./apps/core-deployment/

mv ./apps/deployment/node_modules/ ./apps/backend/node_modules/
rm ./apps/backend/node_modules/@stats-organization/github-readme-stats-core
mv ./apps/core-deployment/ ./apps/backend/node_modules/@stats-organization/github-readme-stats-core

./vercel-preparation.sh
