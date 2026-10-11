import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LinkedVictusUser } from './coinTransactionLock.js';
import type { Cell, PvpGame } from './pvpRules.js';

export interface PvpPayment {
    player: 0 | 1;
    delta: number;
    kind: 'stake' | 'payout' | 'refund';
    reference: string;
    status: 'pending' | 'paid' | 'rejected';
}
export interface PvpMatch {
    id: string;
    game: PvpGame;
    players: [LinkedVictusUser, LinkedVictusUser];
    stake: number;
    status: 'invited' | 'funding' | 'active' | 'settling' | 'complete';
    createdAt: number;
    expiresAt: number;
    completedAt?: number;
    acceptedAt?: number;
    guildId: string;
    channelId: string;
    messageId?: string;
    turn: 0 | 1;
    revision: number;
    board: Cell[];
    choices: [string | null, string | null];
    winner?: 0 | 1 | null;
    reason?: string;
    payments: PvpPayment[];
    mobPowers?: [number, number];
    battleRolls?: [number, number];
}
export interface PvpState {
    version: 1;
    matches: Record<string, PvpMatch>;
    cooldowns: Record<string, number>;
}

export class PvpStore {
    constructor(private path = join(process.cwd(), 'data', 'pvp-matches.json')) {}
    async load(): Promise<PvpState> {
        try {
            const state = JSON.parse(await readFile(this.path, 'utf8'));
            if (state.version !== 1 || !state.matches || !state.cooldowns) throw new Error('Invalid PvP journal; staff must restore it.');
            return state;
        } catch (error: any) {
            if (error?.code === 'ENOENT') return { version: 1, matches: {}, cooldowns: {} };
            throw error;
        }
    }
    async save(state: PvpState) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        const file = await open(temporary, 'w');
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, this.path);
    }
}
