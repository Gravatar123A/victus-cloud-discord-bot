import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const entrypoint = new URL("./dist/index.js", import.meta.url);
const discordJsPackage = new URL("./node_modules/discord.js/package.json", import.meta.url);
const discordJsUser = new URL("./node_modules/discord.js/src/structures/User.js", import.meta.url);

// 1. Verify critical dependencies
if (!existsSync(discordJsPackage) || !existsSync(discordJsUser)) {
    console.log("[Victus Bot] Dependencies missing or incomplete in node_modules. Running clean production install...");
    const install = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--cache=/tmp/.npm"], {
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (install.status !== 0) {
        console.error(
            "\n[Victus Bot] ❌ Failed to install dependencies (code " + install.status + ").\n" +
            "[Victus Bot] ⚠️ Your server disk quota is likely 100% full or node_modules has invalid permissions.\n" +
            "[Victus Bot] 💡 Fix: In Pterodactyl File Manager, delete the 'node_modules' folder and any files in 'logs/', then restart.\n"
        );
        process.exit(install.status || 1);
    }
}

// 2. Verify compiled entrypoint
const hasDist = existsSync(entrypoint) && statSync(entrypoint).size > 0;
if (!hasDist) {
    console.log("[Victus Bot] dist/index.js not found. Building TypeScript before startup...");
    const build = spawnSync("npm", ["run", "build"], {
        stdio: "inherit",
        shell: process.platform === "win32",
    });

    if (build.status !== 0) {
        console.error("[Victus Bot] Build failed. Check the TypeScript errors above.");
        process.exit(build.status || 1);
    }
}

await import("./dist/index.js");
