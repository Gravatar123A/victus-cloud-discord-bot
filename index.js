import { existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const entrypoint = path.join(rootDir, "dist", "index.js");
const discordJsPackage = path.join(rootDir, "node_modules", "discord.js", "package.json");
const nodeModulesDir = path.join(rootDir, "node_modules");

// 1. Ensure node_modules directory exists
try {
    if (!existsSync(nodeModulesDir)) {
        mkdirSync(nodeModulesDir, { recursive: true });
    }
} catch (e) {
    // Ignore pre-creation errors
}

// 2. Verify critical dependencies
if (!existsSync(discordJsPackage)) {
    console.log("[Victus Bot] Dependencies missing in node_modules. Running clean production install...");
    const tmpCache = process.platform === "win32" ? path.join(rootDir, ".npm-cache") : "/tmp/.npm";
    try {
        mkdirSync(tmpCache, { recursive: true });
    } catch {}

    spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
}

// 3. Verify compiled entrypoint and critical dist modules
const loggerFile = path.join(rootDir, "dist", "utils", "logger.js");
const commandsIndex = path.join(rootDir, "dist", "commands", "index.js");

let hasCompleteDist =
    existsSync(entrypoint) &&
    statSync(entrypoint).size > 0 &&
    existsSync(loggerFile) &&
    existsSync(commandsIndex);

// GitHub sync may restore an old tracked dist tree with timestamps equal to src.
// A source fingerprint makes the rebuild decision independent of file times.
function hashSources(dir, hash) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) hashSources(file, hash);
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
            hash.update(path.relative(rootDir, file));
            hash.update(readFileSync(file));
        }
    }
}

const sourceDir = path.join(rootDir, "src");
const buildStamp = path.join(rootDir, ".victus-source-hash");
let sourceHash = null;
if (existsSync(sourceDir)) {
    const hash = createHash("sha256");
    hashSources(sourceDir, hash);
    sourceHash = hash.digest("hex");
}
const sourceIsNewer = sourceHash !== null &&
    (!hasCompleteDist || !existsSync(buildStamp) || readFileSync(buildStamp, "utf8").trim() !== sourceHash);

if (!hasCompleteDist) {
    console.log("[Victus Bot] dist files incomplete or missing. Restoring pre-built dist from git...");
    // Attempt 1: Git checkout pre-built dist (fastest, 0 memory, guaranteed clean)
    try {
        spawnSync("git", ["checkout", "HEAD", "--", "dist/"], {
            cwd: rootDir,
            stdio: "ignore",
            shell: process.platform === "win32",
        });
    } catch {}

    hasCompleteDist =
        existsSync(entrypoint) &&
        existsSync(loggerFile) &&
        existsSync(commandsIndex);

}

if (sourceIsNewer || !hasCompleteDist) {
    console.log("[Victus Bot] Building updated TypeScript before startup...");
    const build = spawnSync("npm", ["run", "build"], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    hasCompleteDist = build.status === 0 && existsSync(entrypoint) && existsSync(loggerFile);
    if (hasCompleteDist && sourceHash) writeFileSync(buildStamp, sourceHash);
}

// 4. Launch bot (with tsx fallback if dist is unavailable)
if (hasCompleteDist) {
    try {
        await import("./dist/index.js");
    } catch (err) {
        console.error("[Victus Bot] Error importing dist/index.js:", err?.message || err);
        console.log("[Victus Bot] Launching fallback directly via tsx src/index.ts...");
        const tsxRun = spawnSync("npx", ["tsx", "src/index.ts"], {
            cwd: rootDir,
            stdio: "inherit",
            shell: process.platform === "win32",
        });
        process.exit(tsxRun.status || 0);
    }
} else {
    console.log("[Victus Bot] dist unavailable. Launching directly via tsx src/index.ts...");
    const tsxRun = spawnSync("npx", ["tsx", "src/index.ts"], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    process.exit(tsxRun.status || 0);
}

