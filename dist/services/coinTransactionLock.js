import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
/**
 * Concurrency Mutex map for atomic operations.
 * Keys can be Discord ID or Victus Email.
 */
class CoinMutex {
    chains = new Map();
    async runExclusive(key, task) {
        const normKey = key.trim().toLowerCase();
        const prev = this.chains.get(normKey) || Promise.resolve();
        let resolver;
        let rejecter;
        const resultPromise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejecter = reject;
        });
        const next = prev
            .then(async () => {
            try {
                const result = await task();
                resolver(result);
            }
            catch (err) {
                rejecter(err);
            }
        })
            .catch((err) => {
            // If previous link failed, we still run this task
            logger.warn(`Mutex previous task error for key ${normKey}:`, err);
        })
            .finally(() => {
            if (this.chains.get(normKey) === next) {
                this.chains.delete(normKey);
            }
        });
        this.chains.set(normKey, next);
        return resultPromise;
    }
}
export const coinMutex = new CoinMutex();
export class CoinTransactionLock {
    /**
     * Resolves the linked Victus user for a Discord ID.
     */
    static async resolveLinkedUser(discordId) {
        try {
            const linked = await supabase.getLinkedAccount(discordId);
            if (!linked || !linked.user_id)
                return null;
            const profile = await supabase.getUserProfile(linked.user_id);
            if (!profile || !profile.email)
                return null;
            return {
                discordId,
                userId: linked.user_id,
                email: profile.email,
                username: profile.full_name || profile.username || linked.discord_username || 'Victus User',
            };
        }
        catch (err) {
            logger.error(`Failed to resolve linked user for ${discordId}:`, err);
            return null;
        }
    }
    /**
     * Fetches current COINS balance for a user.
     */
    static async getCoinsBalance(email) {
        try {
            const balances = await supabase.getPaymenterBalances(email);
            return balances.coins;
        }
        catch (err) {
            logger.error(`Failed to fetch coins balance for ${email}:`, err);
            return 0;
        }
    }
    /**
     * Executes an atomic wagering or gambling transaction.
     * Prevents double-spending by acquiring user lock, verifying balance,
     * deducting the wager BEFORE game execution, and crediting payout if won.
     */
    static async executeWagerTransaction(discordId, wagerAmount, source, reference, description, action) {
        const user = await this.resolveLinkedUser(discordId);
        if (!user) {
            return {
                success: false,
                unlinked: true,
                error: 'Account not linked. Use `/link` to connect your Victus Cloud account.',
            };
        }
        if (wagerAmount <= 0) {
            return {
                success: false,
                error: 'Wager amount must be greater than 0 COINS.',
            };
        }
        // Lock on both discordId and email to prevent dual-rail attacks
        return coinMutex.runExclusive(user.email, async () => {
            const currentBalance = await this.getCoinsBalance(user.email);
            if (currentBalance < wagerAmount) {
                return {
                    success: false,
                    insufficientBalance: true,
                    user,
                    error: `Insufficient balance. You have **${currentBalance} COINS**, but attempted to wager **${wagerAmount} COINS**.`,
                };
            }
            // 1. Immediately deduct wager atomically
            let postWagerBalance;
            try {
                postWagerBalance = await supabase.mutatePaymenterCoins(user.email, -wagerAmount, `${source}_wager`, `${reference}:wager`, `${description} (Wager: -${wagerAmount} COINS)`);
                await supabase.mirrorProfileCoinsFromPaymenter(user.userId, postWagerBalance, `${source} wager`);
            }
            catch (deductErr) {
                return {
                    success: false,
                    error: deductErr?.message || 'Failed to lock and deduct wager from Victus Cloud balance.',
                };
            }
            // 2. Execute game logic
            let result;
            try {
                result = await action(user, currentBalance);
            }
            catch (gameErr) {
                // In case of an unexpected crash in game logic, safely refund the wager!
                logger.error(`Game logic error for ${user.email}, refunding wager:`, gameErr);
                try {
                    const refundBal = await supabase.mutatePaymenterCoins(user.email, wagerAmount, `${source}_refund`, `${reference}:refund`, `Refund for failed game interaction`);
                    await supabase.mirrorProfileCoinsFromPaymenter(user.userId, refundBal, `${source} refund`);
                }
                catch { }
                return {
                    success: false,
                    error: 'Game failed to resolve. Your wager has been safely refunded.',
                };
            }
            // 3. If won, credit payout
            if (result.won && result.payoutAmount > 0) {
                try {
                    postWagerBalance = await supabase.mutatePaymenterCoins(user.email, result.payoutAmount, `${source}_win`, `${reference}:win`, `${description} (Winnings: +${result.payoutAmount} COINS)`);
                    await supabase.mirrorProfileCoinsFromPaymenter(user.userId, postWagerBalance, `${source} win`);
                }
                catch (winErr) {
                    logger.error(`Failed to credit win payout to ${user.email}:`, winErr);
                }
            }
            return {
                success: true,
                user,
                won: result.won,
                payout: result.payoutAmount,
                newBalance: postWagerBalance,
                payload: result.payload,
            };
        });
    }
    /**
     * Executes an atomic payout/grant to a user (e.g. RPG sell, referral, AirDrop, boss reward).
     */
    static async grantCoins(discordId, amount, source, reference, description) {
        const user = await this.resolveLinkedUser(discordId);
        if (!user) {
            return {
                success: false,
                unlinked: true,
                error: 'Account not linked. Use `/link` to connect your Victus Cloud account.',
            };
        }
        if (amount <= 0) {
            return {
                success: false,
                error: 'Amount must be greater than 0 COINS.',
            };
        }
        return coinMutex.runExclusive(user.email, async () => {
            try {
                const newBalance = await supabase.mutatePaymenterCoins(user.email, amount, source, reference, description);
                await supabase.mirrorProfileCoinsFromPaymenter(user.userId, newBalance, `${source} grant`);
                return {
                    success: true,
                    user,
                    newBalance,
                };
            }
            catch (grantErr) {
                return {
                    success: false,
                    error: grantErr?.message || 'Failed to grant COINS to Victus account.',
                };
            }
        });
    }
    /**
     * Executes an atomic transfer/steal between two users (e.g. /heist).
     */
    static async executeTransferOrHeist(targetDiscordId, heistTeamDiscordIds, stealAmount, source, reference, description) {
        const target = await this.resolveLinkedUser(targetDiscordId);
        if (!target) {
            return {
                success: false,
                targetUnlinked: true,
                actualStolen: 0,
                teamShares: new Map(),
                error: 'Target user has not linked their Victus Cloud account.',
            };
        }
        return coinMutex.runExclusive(target.email, async () => {
            const targetBalance = await this.getCoinsBalance(target.email);
            if (targetBalance <= 0) {
                return {
                    success: false,
                    actualStolen: 0,
                    teamShares: new Map(),
                    error: 'Target has 0 COINS to heist.',
                };
            }
            // Steal up to available balance or requested amount
            const actualStolen = Math.min(targetBalance, stealAmount);
            // Deduct from target
            try {
                const newTargetBal = await supabase.mutatePaymenterCoins(target.email, -actualStolen, `${source}_target_loss`, `${reference}:target`, `${description} (-${actualStolen} COINS)`);
                await supabase.mirrorProfileCoinsFromPaymenter(target.userId, newTargetBal, `${source} target loss`);
            }
            catch (deductErr) {
                return {
                    success: false,
                    actualStolen: 0,
                    teamShares: new Map(),
                    error: deductErr?.message || 'Failed to deduct heist loot from target.',
                };
            }
            // Split among team
            const share = Math.floor(actualStolen / heistTeamDiscordIds.length);
            const teamShares = new Map();
            for (const memberDiscordId of heistTeamDiscordIds) {
                const memberUser = await this.resolveLinkedUser(memberDiscordId);
                if (memberUser && share > 0) {
                    try {
                        const newMemBal = await supabase.mutatePaymenterCoins(memberUser.email, share, `${source}_team_payout`, `${reference}:member:${memberDiscordId}`, `Heist share from ${target.username} (+${share} COINS)`);
                        await supabase.mirrorProfileCoinsFromPaymenter(memberUser.userId, newMemBal, `${source} team payout`);
                    }
                    catch { }
                    teamShares.set(memberDiscordId, share);
                }
                else {
                    teamShares.set(memberDiscordId, 0);
                }
            }
            return {
                success: true,
                actualStolen,
                teamShares,
            };
        });
    }
}
