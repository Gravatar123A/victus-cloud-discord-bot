import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export class PvpStore {
    path;
    constructor(path = join(process.cwd(), 'data', 'pvp-matches.json')) {
        this.path = path;
    }
    async load() {
        try {
            const state = JSON.parse(await readFile(this.path, 'utf8'));
            if (state.version !== 1 || !state.matches || !state.cooldowns)
                throw new Error('Invalid PvP journal; staff must restore it.');
            return state;
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return { version: 1, matches: {}, cooldowns: {} };
            throw error;
        }
    }
    async save(state) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        const file = await open(temporary, 'w');
        try {
            await file.writeFile(JSON.stringify(state));
            await file.sync();
        }
        finally {
            await file.close();
        }
        await rename(temporary, this.path);
    }
}
