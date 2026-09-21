import { existsSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

    // Attempt 2: Compile TypeScript if git restore didn't populate it
    if (!hasCompleteDist) {
        console.log("[Victus Bot] Building TypeScript before startup...");
        const build = spawnSync("npm", ["run", "build"], {
            cwd: rootDir,
            stdio: "inherit",
            shell: process.platform === "win32",
        });

        hasCompleteDist =
            build.status === 0 &&
            existsSync(entrypoint) &&
            existsSync(loggerFile);
    }
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

