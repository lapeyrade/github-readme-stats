import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "apps/backend/.vercel/output");
const functionPath = path.join(output, "functions/api.func");

const run = (args) => {
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed`);
  }
};

run(["run", "build:packages"]);
run(["run", "build:frontend"]);

// Generate a complete Build Output API artifact, independent of upstream's
// removed Vercel templates. Never delete project links or environment files.
await rm(output, { recursive: true, force: true });
await mkdir(path.dirname(functionPath), { recursive: true });
run([
  "--filter",
  "./apps/backend/",
  "--legacy",
  "--prod",
  "deploy",
  functionPath,
]);
const corePath = path.join(output, "core-deployment");
run([
  "--filter",
  "@stats-organization/github-readme-stats-core",
  "--legacy",
  "--prod",
  "deploy",
  corePath,
]);
const packagedCore = path.join(
  functionPath,
  "node_modules/@stats-organization/github-readme-stats-core",
);
await rm(packagedCore, { recursive: true, force: true });
await rename(corePath, packagedCore);

const corePackage = JSON.parse(
  await readFile(path.join(packagedCore, "package.json"), "utf8"),
);
await readFile(path.join(packagedCore, corePackage.main));
await readFile(path.join(functionPath, "vercel-handler.js"));
await writeFile(
  path.join(functionPath, ".vc-config.json"),
  JSON.stringify({
    runtime: "nodejs24.x",
    handler: "vercel-handler.js",
    launcherType: "Nodejs",
  }),
);
await cp(
  path.join(root, "apps/frontend/build"),
  path.join(output, "static/frontend"),
  { recursive: true },
);
await writeFile(
  path.join(output, "config.json"),
  JSON.stringify({
    version: 3,
    routes: [
      { src: "/", status: 307, headers: { Location: "/frontend/docs/" } },
      { handle: "filesystem" },
      { src: "/api(?:/.*)?", dest: "/api" },
    ],
  }),
);
console.log(`Vercel output ready: core ${corePackage.version}`);
