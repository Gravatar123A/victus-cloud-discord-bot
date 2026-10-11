/** Shared by inventory writers and raid lifecycle operations in this bot process. */
const chains = new Map();
export async function withGameLock(key, task) {
    const previous = chains.get(key) || Promise.resolve();
    const next = previous.catch(() => { }).then(task);
    chains.set(key, next);
    try {
        return await next;
    }
    finally {
        if (chains.get(key) === next)
            chains.delete(key);
    }
}
