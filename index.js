import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const entrypoint = new URL("./dist/index.js", import.meta.url);
const sourceFiles = [
    "./src/index.ts",
    "./src/embeds/music.ts",
    "./src/events/ready.ts",
].map((file) => new URL(file, import.meta.url));
const sourceChanged = existsSync(entrypoint)
    ? sourceFiles.some((file) => existsSync(file) && statSync(file).mtimeMs > statSync(entrypoint).mtimeMs)
    : true;

if (!existsSync(entrypoint) || statSync(entrypoint).size === 0 || sourceChanged) {
    console.log("[Victus Bot] Compiled output is missing, empty, or stale. Building TypeScript before startup...");
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
