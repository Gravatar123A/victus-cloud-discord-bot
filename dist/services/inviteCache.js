// In-memory cache of every guild's invite use-counts, keyed by guild then by
// invite code. Discord does not tell you which invite a joining member used, so
// the standard technique is: cache each invite's `uses` count, and on join
// re-fetch and diff to find the code whose count incremented -> its inviter.
//
// Seeded on `ready` (guild.invites.fetch), kept in sync by the inviteCreate /
// inviteDelete events, and refreshed on every guildMemberAdd. The cache is lost
// on restart and re-seeded on the next ready (see risks in the diagnosis).
// Map<guildId, Map<inviteCode, CachedInvite>>
export const inviteCache = new Map();
/** Get (creating if needed) the per-guild code->uses map. */
export function getGuildInvites(guildId) {
    let guildMap = inviteCache.get(guildId);
    if (!guildMap) {
        guildMap = new Map();
        inviteCache.set(guildId, guildMap);
    }
    return guildMap;
}
/** Replace a guild's entire invite snapshot (used on ready + after each join). */
export function setGuildInvites(guildId, invites) {
    inviteCache.set(guildId, invites);
}
/** Add or update a single cached invite. */
export function upsertInvite(guildId, code, data) {
    getGuildInvites(guildId).set(code, data);
}
/** Drop a single invite (e.g. it was deleted or fully used up). */
export function removeInvite(guildId, code) {
    inviteCache.get(guildId)?.delete(code);
}
