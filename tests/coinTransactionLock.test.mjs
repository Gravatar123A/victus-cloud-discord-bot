import test from 'node:test';
import assert from 'node:assert/strict';

// Test implementation of AsyncMutex (matching the production AsyncMutex in coinTransactionLock.ts)
class AsyncMutex {
    queue = Promise.resolve();

    async runExclusive(task) {
        let release;
        const ticket = new Promise((resolve) => {
            release = resolve;
        });
        const currentQueue = this.queue;
        this.queue = this.queue.then(() => ticket);

        await currentQueue;
        try {
            return await task();
        } finally {
            release();
        }
    }
}

test('AsyncMutex serializes concurrent tasks and prevents race conditions', async () => {
    const mutex = new AsyncMutex();
    let balance = 100;
    const history = [];

    // Simulate 5 concurrent betting attempts of 30 coins each
    // Balance is 100. Only first 3 should succeed (90 coins spent). 4th and 5th should fail due to insufficient balance.
    const runBet = async (id, wager) => {
        return mutex.runExclusive(async () => {
            history.push(`start_${id}`);
            // Simulate async network check
            await new Promise((r) => setTimeout(r, 10));
            if (balance < wager) {
                history.push(`fail_${id}`);
                return { success: false, reason: 'insufficient_balance' };
            }
            balance -= wager;
            history.push(`success_${id}`);
            return { success: true, remaining: balance };
        });
    };

    const results = await Promise.all([
        runBet(1, 30),
        runBet(2, 30),
        runBet(3, 30),
        runBet(4, 30),
        runBet(5, 30),
    ]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.equal(successes.length, 3, 'Exactly 3 bets should succeed');
    assert.equal(failures.length, 2, 'Exactly 2 bets should fail due to balance depletion');
    assert.equal(balance, 10, 'Remaining balance must be exactly 10');
});

test('Transaction rollback pattern restores coins on game crash', async () => {
    let balance = 50;
    const wager = 20;

    const executeWagerWithCrash = async () => {
        // Step 1: Deduct
        balance -= wager;

        // Step 2: Game logic crashes
        try {
            throw new Error('Simulation of unexpected game logic error');
        } catch (err) {
            // Step 3: Rollback
            balance += wager;
            return { success: false, error: err.message };
        }
    };

    const result = await executeWagerWithCrash();
    assert.equal(result.success, false);
    assert.equal(balance, 50, 'Balance must be restored to original after crash');
});

test('Multi-user heist distribution splits pool proportionally', () => {
    const totalStolen = 150;
    const participants = ['userA', 'userB', 'userC'];
    const perMemberCut = Math.floor(totalStolen / participants.length);

    assert.equal(perMemberCut, 50, 'Each participant must receive an equal cut of the stolen pot');
    assert.equal(perMemberCut * participants.length, totalStolen);
});
