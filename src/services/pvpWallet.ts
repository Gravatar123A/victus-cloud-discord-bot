import { CoinTransactionLock, coinMutex, type LinkedVictusUser } from './coinTransactionLock.js';
import { supabase } from './supabase.js';
import type { PvpPayment } from './pvpStore.js';
import { logger } from '../utils/logger.js';

export interface PvpWallet {
    resolve(id: string): Promise<LinkedVictusUser | null>;
    balance(player: LinkedVictusUser): Promise<number>;
    apply(player: LinkedVictusUser, payment: PvpPayment): Promise<'paid' | 'rejected'>;
}

export const pvpWallet: PvpWallet = {
    resolve: id => CoinTransactionLock.resolveLinkedUser(id),
    async balance(player) {
        const result = await supabase.getPaymenterBalances(player.email);
        if (!result.found) throw new Error('Paymenter balance is unavailable. No match has started.');
        return result.coins;
    },
    async apply(player, payment) {
        return coinMutex.runExclusive(player.email, async () => {
            // Never precheck on recovery: an ambiguous prior debit may have succeeded.
            // Paymenter deduplicates source+reference BEFORE checking available funds.
            let balance: number;
            try {
                balance = await supabase.mutatePaymenterCoins(player.email, payment.delta,
                    `pvp_${payment.kind}`, payment.reference, `PvP ${payment.kind}: ${payment.delta} COINS`);
            } catch (error: any) {
                if (payment.delta < 0 && error?.insufficientCoins === true) return 'rejected';
                throw error;
            }
            // A website mirror failure must not make a confirmed Paymenter transfer fail.
            try {
                const fresh = await supabase.getPaymenterBalances(player.email);
                if (fresh.found) balance = fresh.coins;
                await supabase.mirrorProfileCoinsFromPaymenter(player.userId, balance, 'PvP settlement');
                await supabase.recordEconomyLedger({ userId: player.userId, kind: `pvp_${payment.kind}`,
                    amount: payment.delta, balanceAfter: balance, reason: 'Player versus player game', meta: { reference: payment.reference } });
            } catch { logger.warn('PvP Paymenter transfer confirmed; website mirror will reconcile later.'); }
            return 'paid';
        });
    },
};
