import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(projectRoot, "dist");
const rawTarget = process.env.DEPLOY_TARGET?.trim();

if (!rawTarget) {
  console.error(
    "Set DEPLOY_TARGET in `.env` (DEPLOY_TARGET=...) or in the environment before `npm run deploy`.",
  );
  process.exit(1);
}

const targetDir = resolve(projectRoot, rawTarget);

if (targetDir === "/" || targetDir === resolve("/")) {
  console.error("DEPLOY_TARGET is unsafe (filesystem root).");
  process.exit(1);
}

if (!existsSync(distDir)) {
  console.error("Missing dist/. Run `npm run build` first.");
  process.exit(1);
}

const distStat = await stat(distDir);
if (!distStat.isDirectory()) {
  console.error("dist is not a directory.");
  process.exit(1);
}

function findGitRoot(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Do not remove repo metadata if DEPLOY_TARGET is the repository root. */
const SKIP_DELETE_NAMES = new Set([".git", ".gitmodules"]);

await mkdir(targetDir, { recursive: true });

const existing = await readdir(targetDir);
for (const name of existing) {
  if (SKIP_DELETE_NAMES.has(name)) {
    continue;
  }
  await rm(join(targetDir, name), { recursive: true, force: true });
}

const toCopy = await readdir(distDir);
if (toCopy.length === 0) {
  console.warn("dist is empty — target was cleared; nothing copied.");
  process.exit(0);
}

for (const name of toCopy) {
  await cp(join(distDir, name), join(targetDir, name), { recursive: true });
}

console.log(`Done: ${toCopy.length} item(s) from dist → ${targetDir}`);

const gitRoot = findGitRoot(targetDir);
if (!gitRoot) {
  console.error(
    "DEPLOY_TARGET is not inside a Git working tree (.git not found in this folder or parents).",
  );
  process.exit(1);
}

const relToGit = relative(gitRoot, resolve(targetDir));
if (relToGit.startsWith("..")) {
  console.error("DEPLOY_TARGET must be inside the Git repository.");
  process.exit(1);
}

const pkgRaw = await readFile(join(projectRoot, "package.json"), "utf8");
let version;
try {
  ({ version } = JSON.parse(pkgRaw));
} catch {
  console.error("Could not read version from package.json.");
  process.exit(1);
}

const commitMessage = `version ${version}`;
const addPath = relToGit === "" ? "." : relToGit.split(sep).join("/");
const addArgs =
  addPath === "." ? ["git", "add", "-A"] : ["git", "add", "--", addPath];

const addResult = spawnSync(addArgs[0], addArgs.slice(1), {
  cwd: gitRoot,
  stdio: "inherit",
});
if (addResult.status !== 0) {
  process.exit(addResult.status ?? 1);
}

let hasStagedChanges = true;
{
  const diff = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: gitRoot,
    stdio: "ignore",
  });
  hasStagedChanges = diff.status !== 0;
}

if (!hasStagedChanges) {
  console.log(
    "Nothing to commit (already up to date). Skipping commit and push.",
  );
  process.exit(0);
}

const commitResult = spawnSync("git", ["commit", "-m", commitMessage], {
  cwd: gitRoot,
  stdio: "inherit",
});
if (commitResult.status !== 0) {
  process.exit(commitResult.status ?? 1);
}

const pushResult = spawnSync("git", ["push"], {
  cwd: gitRoot,
  stdio: "inherit",
});
if (pushResult.status !== 0) {
  process.exit(pushResult.status ?? 1);
}

console.log(`Git: committed "${commitMessage}" and pushed from ${gitRoot}`);
