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

// 3. Verify compiled entrypoint
const hasDist = existsSync(entrypoint) && statSync(entrypoint).size > 0;
if (!hasDist) {
    console.log("[Victus Bot] dist/index.js not found. Building TypeScript before startup...");
    const build = spawnSync("npm", ["run", "build"], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });

    if (build.status !== 0) {
        console.error("[Victus Bot] Build failed. Check the TypeScript errors above.");
        process.exit(build.status || 1);
    }
}

await import("./dist/index.js");

