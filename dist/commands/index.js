import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';
// Import commands
import { linkCommand } from './link.js';
import { unlinkCommand } from './unlink.js';
import { serversCommand } from './servers.js';
import { servicesCommand } from './services.js';
import { invoicesCommand } from './invoices.js';
import { helpCommand } from './help.js';
import { adminCommand } from './admin/index.js';
import { configCommand } from './config.js';
import { userCommand } from './user.js';
import { ticketCommand } from './ticket.js';
import { ticketPanelCommand, ticketPanelAliasCommand } from './ticket-panel.js';
import { preferencesCommand } from './preferences.js';
import { announceCommand } from './announce.js';
import { anncCommand } from './annc.js';
import { accountCommand } from './account.js';
import { linkPanelAliasCommand, linkPanelCommand } from './link-panel.js';
import { createAccountCommand } from './create-account.js';
import { askCommand } from './ask.js';
import { summonCommand } from './summon.js';
import { economyCommand } from './economy.js';
import { musicCommands } from './music/index.js';
import { prefixCommand, setprefixCommand } from './prefix.js';
import { embedCommand, embedListActionButtons, embedLinksRouter } from './embed.js';
import { suggestCommand, suggestionCommand } from './suggest.js';
import { giveawayCommand } from './giveaway.js';
import { customcmdCommand } from './customcmd.js';
import { welcomeCommand } from './welcome.js';
import { staffAppCommand } from './staff-app.js';
import { j2cCommand } from './j2c.js';
import { warnCommand } from './warn.js';
import { dmCommand } from './dm.js';
import { playlistCommand } from './playlist.js';
import { afkCommand } from './afk.js';
import { purgeCommand } from './purge.js';
import { kickCommand } from './kick.js';
import { banCommand } from './ban.js';
import { timeoutCommand } from './timeout.js';
import { vpsStatsCommand } from './vpsstats.js';
import { pollCommand } from './poll.js';
import { auditLogCommand } from './auditLog.js';
import { reactRolesCommand } from './reactroles.js';
import { serverStatsCommand } from './serverstats.js';
import { unbanCommand } from './unban.js';
import { untimeoutCommand } from './untimeout.js';
import { whitelistCommand } from './whitelist.js';
import { communityCoinsCommand } from './community-coins.js';
import { levelCommand } from './level.js';
import { rankCommand } from './rank.js';
import { shareResourceCommand } from './shareResource.js';
import { massShareResourceCommand } from './massShareResource.js';
import { resourceApplyCommand } from './resourceApply.js';
import { manualDcLinkCommand } from './manualdclink.js';
import { currencyCommand } from './currency.js';
import { pricingCommand } from './pricing.js';
import { leaderboardCommand } from './leaderboard.js';
import { levelChannelCommand } from './levelChannel.js';
import { invitesCommand } from './invites.js';
import { staffaiCommand } from './staffai.js';
import { pingCommand } from './ping.js';
import { pingAdminCommand } from './ping-admin.js';
import { antinukeCommand } from './antinuke.js';
import { browseCommand } from './browse.js';
import { statusCommand } from './status.js';
import { setupCommand } from './setup.js';
import { giveCommand } from './give.js';
// Viral Expansion Engine commands
import { ownerStatsCommand } from './ownerStats.js';
import { hostPromoCommand, freeServerCommand } from './hostPromo.js';
import { rpgCommand, mineCommand, fishCommand, sellCommand, craftCommand } from './rpg.js';
import { coinflipCommand, slotsCommand, heistCommand, rpsCommand, rpsDuelCommand, blackjackCommand } from './gambling.js';
import { tameCommand, zooCommand, battleCommand } from './mobGacha.js';
import { bossCommand, attackCommand, castCommand } from './worldBoss.js';
import { mcSkinCommand, mcStatusCommand, mcWhitelistCommand, serverCommand } from './mcUtils.js';
import { backupWorldCommand } from './lifeboat.js';
import { battlepassCommand, claimAirDropCommand, smpNetworkCommand, warCommand } from './community.js';
import { extraOwnerCommand } from './extraowner.js';
import { countingCommand } from './counting.js';
import { gtnCommand } from './gtn.js';
import { unscrambleCommand } from './unscramble.js';
import { resourceSyncCommand } from './resourceSync.js';
// Export command collection
export const commands = new Collection();
// Register all commands
const allCommands = [
    pingCommand,
    pingAdminCommand,
    staffaiCommand,
    shareResourceCommand,
    massShareResourceCommand,
    resourceApplyCommand,
    manualDcLinkCommand,
    currencyCommand,
    pricingCommand,
    linkCommand,
    unlinkCommand,
    serversCommand,
    servicesCommand,
    invoicesCommand,
    helpCommand,
    adminCommand,
    configCommand,
    userCommand,
    ticketCommand,
    ticketPanelCommand,
    ticketPanelAliasCommand,
    preferencesCommand,
    announceCommand,
    anncCommand,
    accountCommand,
    linkPanelCommand,
    linkPanelAliasCommand,
    createAccountCommand,
    askCommand,
    summonCommand,
    economyCommand,
    prefixCommand,
    setprefixCommand,
    embedCommand,
    embedListActionButtons,
    embedLinksRouter,
    suggestCommand,
    suggestionCommand,
    giveawayCommand,
    customcmdCommand,
    welcomeCommand,
    staffAppCommand,
    j2cCommand,
    warnCommand,
    dmCommand,
    playlistCommand,
    afkCommand,
    purgeCommand,
    kickCommand,
    banCommand,
    timeoutCommand,
    vpsStatsCommand,
    pollCommand,
    auditLogCommand,
    reactRolesCommand,
    serverStatsCommand,
    unbanCommand,
    untimeoutCommand,
    whitelistCommand,
    antinukeCommand,
    extraOwnerCommand,
    communityCoinsCommand,
    levelCommand,
    rankCommand,
    levelChannelCommand,
    leaderboardCommand,
    invitesCommand,
    ownerStatsCommand,
    hostPromoCommand,
    freeServerCommand,
    rpgCommand,
    mineCommand,
    fishCommand,
    sellCommand,
    craftCommand,
    coinflipCommand,
    rpsCommand,
    rpsDuelCommand,
    blackjackCommand,
    slotsCommand,
    heistCommand,
    tameCommand,
    zooCommand,
    battleCommand,
    bossCommand,
    attackCommand,
    castCommand,
    mcSkinCommand,
    mcStatusCommand,
    mcWhitelistCommand,
    serverCommand,
    backupWorldCommand,
    battlepassCommand,
    claimAirDropCommand,
    smpNetworkCommand,
    warCommand,
    browseCommand,
    statusCommand,
    setupCommand,
    countingCommand,
    gtnCommand,
    giveCommand,
    unscrambleCommand,
    resourceSyncCommand,
    ...musicCommands,
];
for (const command of allCommands) {
    commands.set(command.data.name, command);
}
/**
 * Load commands into the client
 */
export async function loadCommands(client) {
    for (const [name, command] of commands) {
        client.commands.set(name, command);
        logger.debug(`Loaded command: ${name}`);
    }
}
/**
 * Command names meant to work globally and in DMs.
 * All other commands are server-only (registered per-guild with dm_permission: false).
 */
export const GLOBAL_COMMAND_NAMES = [
    'ping',
    'ping-admin',
    'help',
    'link',
    'unlink',
    'servers',
    'browse',
    'status',
    'services',
    'invoices',
    'ask',
    'currency',
    'pricing',
    'account',
    'create-account',
    'preferences',
    'level',
    'rpg',
    'mine',
    'fish',
    'sell',
    'craft',
];
/**
 * Get all command data for registration (complete catalog)
 */
export function getCommandData() {
    return allCommands
        .filter((cmd) => !cmd.data.name.startsWith('_'))
        .map((cmd) => cmd.data.toJSON());
}
/**
 * Get Global (DM-enabled) command payloads with dm_permission: true
 */
export function getGlobalCommandData() {
    return allCommands
        .filter((cmd) => !cmd.data.name.startsWith('_') && GLOBAL_COMMAND_NAMES.includes(cmd.data.name))
        .map((cmd) => {
        const json = cmd.data.toJSON();
        return { ...json, dm_permission: true };
    });
}
/**
 * Get Guild-only (server-scoped) command payloads with dm_permission: false
 */
export function getGuildCommandData() {
    return allCommands
        .filter((cmd) => !cmd.data.name.startsWith('_') && !GLOBAL_COMMAND_NAMES.includes(cmd.data.name))
        .map((cmd) => {
        const json = cmd.data.toJSON();
        return { ...json, dm_permission: false };
    });
}
