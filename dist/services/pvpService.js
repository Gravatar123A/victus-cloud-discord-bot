import { randomInt, randomUUID } from 'node:crypto';
import { PvpStore } from './pvpStore.js';
import { pvpWallet } from './pvpWallet.js';
import { withGameLock } from './gameLock.js';
import { PVP_COOLDOWN_MS, PVP_INVITE_MS, PVP_TURN_MS, PVP_MAX_STAKE, rpsWinner, placeMove } from './pvpRules.js';
import { logger } from '../utils/logger.js';
export class PvpService {
    store;
    wallet;
    now;
    random;
    constructor(store = new PvpStore(), wallet = pvpWallet, now = Date.now, random = () => randomInt(0, 1_000_000) / 1_000_000) {
        this.store = store;
        this.wallet = wallet;
        this.now = now;
        this.random = random;
    }
    checkAvailable(state, id, except) {
        if (Object.values(state.matches).some(m => m.id !== except && m.status !== 'complete' && m.players.some(p => p.discordId === id))) {
            throw new Error('One player already has a pending or active match. Finish or cancel it first.');
        }
        const until = state.cooldowns[id] || 0;
        if (this.now() < until)
            throw new Error(`This player can start another match in ${Math.ceil((until - this.now()) / 1000)}s.`);
    }
    async create(input) {
        return withGameLock('pvp', async () => {
            if (!input.guildId || !['rps', 'tictactoe', 'connect4', 'battle'].includes(input.game))
                throw new Error('Choose a game in a server.');
            if (input.challenger.bot || input.opponent.bot || input.challenger.id === input.opponent.id)
                throw new Error('Challenge another human player. Bot and self matches are disabled.');
            if (!Number.isSafeInteger(input.stake) || input.stake < 1 || input.stake > PVP_MAX_STAKE)
                throw new Error(`Stake must be 1–${PVP_MAX_STAKE} whole COINS per player.`);
            const state = await this.store.load();
            for (const id of [input.challenger.id, input.opponent.id])
                this.checkAvailable(state, id);
            const a = await this.wallet.resolve(input.challenger.id), b = await this.wallet.resolve(input.opponent.id);
            if (!a || !b)
                throw new Error('Both players must /link their Victus accounts before playing.');
            if (a.userId === b.userId || a.email.toLowerCase() === b.email.toLowerCase())
                throw new Error('Both players must use different Victus accounts.');
            if (input.game === 'battle' && (!input.mobPowers || input.mobPowers.some(p => !Number.isFinite(p) || p <= 0)))
                throw new Error('Both players need a tamed mob before battling.');
            for (const player of [a, b])
                if (await this.wallet.balance(player) < input.stake)
                    throw new Error('Both players need enough COINS for the agreed stake.');
            const match = {
                id: randomUUID(), game: input.game, players: [a, b], stake: input.stake,
                guildId: input.guildId, channelId: input.channelId, createdAt: this.now(), expiresAt: this.now() + PVP_INVITE_MS,
                status: 'invited', turn: this.random() < .5 ? 0 : 1, revision: 0,
                board: Array(input.game === 'tictactoe' ? 9 : input.game === 'connect4' ? 42 : 0).fill(null),
                choices: [null, null], payments: [], mobPowers: input.mobPowers,
            };
            state.matches[match.id] = match;
            state.cooldowns[a.discordId] = this.now() + PVP_COOLDOWN_MS;
            await this.store.save(state);
            return structuredClone(match);
        });
    }
    async attachMessage(id, messageId) {
        return withGameLock('pvp', async () => {
            const state = await this.store.load();
            if (state.matches[id]) {
                state.matches[id].messageId = messageId;
                await this.store.save(state);
            }
        });
    }
    async get(id) {
        return withGameLock('pvp', async () => (await this.store.load()).matches[id] || null);
    }
    async finish(state, match, winner, reason) {
        match.winner = winner;
        match.reason = reason;
        match.status = 'settling';
        match.revision++;
        const funded = match.payments.filter(p => p.kind === 'stake' && p.status === 'paid');
        if (winner !== null && funded.length !== 2)
            throw new Error('Cannot award an unfunded pot.');
        if (!match.payments.some(p => p.kind !== 'stake')) {
            if (winner !== null)
                match.payments.push({ player: winner, delta: match.stake * 2, kind: 'payout', reference: `pvp:${match.id}:winner`, status: 'pending' });
            else
                for (const payment of funded)
                    match.payments.push({ player: payment.player, delta: match.stake, kind: 'refund', reference: `pvp:${match.id}:refund:${payment.player}`, status: 'pending' });
        }
        // Journal the outcome before any payout. Moves can never change it now.
        await this.store.save(state);
        await this.progress(state, match);
    }
    async progress(state, match) {
        if (match.status === 'funding') {
            for (const payment of match.payments.filter(p => p.kind === 'stake')) {
                if (payment.status === 'paid')
                    continue;
                if (payment.status === 'pending') {
                    try {
                        payment.status = await this.wallet.apply(match.players[payment.player], payment);
                    }
                    catch {
                        return;
                    } // Unknown outcome: keep the same reference for recovery.
                    await this.store.save(state);
                }
                if (payment.status === 'rejected') {
                    await this.finish(state, match, null, 'A player had insufficient COINS when accepting. Confirmed stakes are refunded.');
                    return;
                }
            }
            if (this.now() >= match.expiresAt) {
                await this.finish(state, match, null, 'Funding took too long; confirmed stakes are refunded.');
                return;
            }
            if (match.game === 'battle') {
                match.battleRolls ||= [match.mobPowers[0] * (.8 + this.random() * .4), match.mobPowers[1] * (.8 + this.random() * .4)];
                const [a, b] = match.battleRolls;
                await this.finish(state, match, a === b ? null : a > b ? 0 : 1, 'The mob battle has finished.');
                return;
            }
            match.status = 'active';
            match.expiresAt = this.now() + PVP_TURN_MS;
            match.revision++;
            await this.store.save(state);
        }
        if (match.status === 'settling') {
            for (const payment of match.payments.filter(p => p.kind !== 'stake' && p.status === 'pending')) {
                try {
                    payment.status = await this.wallet.apply(match.players[payment.player], payment);
                }
                catch {
                    return;
                }
                if (payment.status !== 'paid')
                    throw new Error('A payout was rejected; staff must inspect the payment journal.');
                await this.store.save(state);
            }
            match.status = 'complete';
            match.completedAt = this.now();
            for (const player of match.players)
                state.cooldowns[player.discordId] = this.now() + PVP_COOLDOWN_MS;
            await this.store.save(state);
        }
    }
    async expire(state, match) {
        if (this.now() < match.expiresAt)
            return;
        if (match.status === 'invited') {
            match.status = 'complete';
            match.reason = 'Challenge expired. No coins were deducted.';
            match.completedAt = this.now();
            await this.store.save(state);
        }
        else if (match.status === 'active') {
            if (match.game === 'rps') {
                const chooser = match.choices[0] ? 0 : match.choices[1] ? 1 : null;
                await this.finish(state, match, chooser, chooser === null ? 'Neither player chose in time. Stakes refunded.' : 'The other player missed the 60-second deadline and forfeited.');
            }
            else
                await this.finish(state, match, match.turn === 0 ? 1 : 0, 'The active player missed the 60-second turn deadline and forfeited.');
        }
    }
    async action(id, actor, action, value, revision) {
        return withGameLock('pvp', async () => {
            const state = await this.store.load(), match = state.matches[id];
            if (!match)
                throw new Error('This match is unavailable. Start a new challenge.');
            const index = match.players.findIndex(p => p.discordId === actor);
            if (index < 0)
                throw new Error('Only the two challenged players can use these controls.');
            const player = index;
            await this.expire(state, match);
            if (['funding', 'settling'].includes(match.status)) {
                await this.progress(state, match);
                return structuredClone(match);
            }
            if (match.status === 'complete' || action === 'refresh')
                return structuredClone(match);
            if (match.status === 'invited') {
                if (action === 'decline' || action === 'cancel') {
                    if (action === 'cancel' && player !== 0 || action === 'decline' && player !== 1)
                        throw new Error('Only the named player can do that.');
                    match.status = 'complete';
                    match.reason = 'Challenge cancelled. No coins were deducted.';
                    match.completedAt = this.now();
                    await this.store.save(state);
                    return structuredClone(match);
                }
                if (action !== 'accept' || player !== 1)
                    throw new Error('Only the challenged opponent can accept this exact stake.');
                this.checkAvailable(state, actor, id);
                // Re-linking before acceptance must not authorize a different billing account.
                for (const expected of match.players) {
                    const linked = await this.wallet.resolve(expected.discordId);
                    if (!linked || linked.userId !== expected.userId || linked.email.toLowerCase() !== expected.email.toLowerCase())
                        throw new Error('An account link changed. Cancel this challenge and start a new one.');
                }
                match.status = 'funding';
                match.acceptedAt = this.now();
                match.expiresAt = this.now() + PVP_TURN_MS;
                match.payments = [0, 1].map(player => ({ player, delta: -match.stake, kind: 'stake', reference: `pvp:${id}:stake:${player}`, status: 'pending' }));
                state.cooldowns[actor] = this.now() + PVP_COOLDOWN_MS;
                await this.store.save(state);
                await this.progress(state, match);
                return structuredClone(match);
            }
            if (action === 'forfeit') {
                await this.finish(state, match, player === 0 ? 1 : 0, 'A player forfeited.');
            }
            else if (match.game === 'rps' && action === 'choose') {
                if (!['rock', 'paper', 'scissors'].includes(value || ''))
                    throw new Error('Choose rock, paper or scissors.');
                if (match.choices[player])
                    throw new Error('Your choice is already locked and hidden until the result.');
                match.choices[player] = value;
                if (match.choices.every(Boolean))
                    await this.finish(state, match, rpsWinner(match.choices[0], match.choices[1]), 'Both choices revealed.');
                else
                    await this.store.save(state);
            }
            else if (['tictactoe', 'connect4'].includes(match.game) && action === 'move') {
                if (match.turn !== player)
                    throw new Error('Wait for your turn.');
                if (revision !== match.revision)
                    throw new Error('That board is out of date. Use the newest buttons.');
                const result = placeMove(match.game, match.board, player, Number(value));
                match.board = result.board;
                match.revision++;
                if (result.winner !== null || result.draw)
                    await this.finish(state, match, result.winner, result.draw ? 'Draw! Both stakes refunded.' : 'Winning line completed.');
                else {
                    match.turn = player === 0 ? 1 : 0;
                    match.expiresAt = this.now() + PVP_TURN_MS;
                    await this.store.save(state);
                }
            }
            else
                throw new Error('That action is not available in this match.');
            return structuredClone(match);
        });
    }
    /** Restart-safe recovery. No Discord collector or in-memory timer owns funds. */
    async recover() {
        return withGameLock('pvp', async () => {
            const state = await this.store.load();
            const changed = [];
            for (const match of Object.values(state.matches)) {
                if (match.status === 'complete')
                    continue;
                const before = JSON.stringify(match);
                try {
                    await this.expire(state, match);
                    await this.progress(state, match);
                }
                catch (error) {
                    logger.warn(`PvP recovery pending for match ${match.id}`);
                }
                if (JSON.stringify(match) !== before)
                    changed.push(structuredClone(match));
            }
            return changed;
        });
    }
}
export const pvpService = new PvpService();
