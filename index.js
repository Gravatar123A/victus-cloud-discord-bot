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

// 2. Verify critical dependencies & integrity
function isDependencyTreeHealthy() {
    if (!existsSync(discordJsPackage)) return false;

    // Check critical discord.js internal files that can be missing from corrupt/interrupted installs
    const criticalDiscordFiles = [
        path.join(rootDir, "node_modules", "discord.js", "src", "structures", "InviteGuild.js"),
        path.join(rootDir, "node_modules", "discord.js", "src", "structures", "User.js"),
        path.join(rootDir, "node_modules", "discord.js", "src", "client", "WebhookClient.js"),
        path.join(rootDir, "node_modules", "discord.js", "src", "structures", "GuildMember.js"),
        path.join(rootDir, "node_modules", "discord.js", "src", "structures", "MessagePayload.js"),
    ];

    for (const file of criticalDiscordFiles) {
        if (!existsSync(file)) {
            console.warn(`[Victus Bot] ⚠️ Missing critical dependency file: ${path.basename(file)}`);
            return false;
        }
    }
    return true;
}

if (!isDependencyTreeHealthy()) {
    console.log("[Victus Bot] 🔄 Dependencies missing or incomplete in node_modules. Running clean production install...");
    try {
        const djsDir = path.join(rootDir, "node_modules", "discord.js");
        if (existsSync(djsDir)) {
            const { rmSync } = await import("node:fs");
            rmSync(djsDir, { recursive: true, force: true });
        }
    } catch (cleanErr) {
        console.warn("[Victus Bot] ⚠️ Warning cleaning old discord.js folder:", cleanErr.message);
    }

    const tmpCache = process.platform === "win32" ? path.join(rootDir, ".npm-cache") : "/tmp/.npm";
    try {
        mkdirSync(tmpCache, { recursive: true });
    } catch {}

    const install = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", `--cache=${tmpCache}`], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: {
            ...process.env,
            HOME: rootDir,
            npm_config_cache: tmpCache,
        },
    });

    if (install.status !== 0) {
        console.error(
            "\n[Victus Bot] ❌ Failed to install dependencies (code " + install.status + ").\n" +
            "[Victus Bot] ⚠️ Your server disk quota may be full or node_modules has bad permissions.\n" +
            "[Victus Bot] 💡 Fix: In Pterodactyl File Manager, delete the 'node_modules' folder and restart the server.\n"
        );
        process.exit(install.status || 1);
    } else {
        console.log("[Victus Bot] ✅ Dependencies verified and restored successfully!");
    }
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

