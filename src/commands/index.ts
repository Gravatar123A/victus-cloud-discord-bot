import { Client, Collection } from 'discord.js';
import type { Command } from '../types/index.js';
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
import { shareResourceCommand } from './shareResource.js';
import { massShareResourceCommand } from './massShareResource.js';
import { resourceApplyCommand } from './resourceApply.js';
import { manualDcLinkCommand } from './manualdclink.js';
import { currencyCommand } from './currency.js';
import { pricingCommand } from './pricing.js';
import { leaderboardCommand } from './leaderboard.js';
import { levelChannelCommand } from './levelChannel.js';
import { staffaiCommand } from './staffai.js';
import { pingCommand } from './ping.js';
import { pingAdminCommand } from './ping-admin.js';


// Viral Expansion Engine commands
import { ownerStatsCommand } from './ownerStats.js';
import { hostPromoCommand, freeServerCommand } from './hostPromo.js';
import { rpgCommand, mineCommand, fishCommand, sellCommand, craftCommand } from './rpg.js';
import { coinflipCommand, slotsCommand, heistCommand } from './gambling.js';
import { tameCommand, zooCommand, battleCommand } from './mobGacha.js';
import { bossCommand, attackCommand, castCommand } from './worldBoss.js';
import { mcSkinCommand, mcStatusCommand, mcWhitelistCommand, serverCommand } from './mcUtils.js';
import { backupWorldCommand } from './lifeboat.js';
import { battlepassCommand, claimAirDropCommand, smpNetworkCommand, warCommand } from './community.js';

// Export command collection
export const commands = new Collection<string, Command>();

// Register all commands
const allCommands: Command[] = [
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
    communityCoinsCommand,
    levelCommand,
    levelChannelCommand,
    leaderboardCommand,
    ownerStatsCommand,
    hostPromoCommand,
    freeServerCommand,
    rpgCommand,
    mineCommand,
    fishCommand,
    sellCommand,
    craftCommand,
    coinflipCommand,
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
    ...musicCommands,
];


for (const command of allCommands) {
    commands.set(command.data.name, command);
}

/**
 * Load commands into the client
 */
export async function loadCommands(client: Client): Promise<void> {
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
    'services',
    'invoices',
    'ask',
    'currency',
    'pricing',
    'account',
    'create-account',
    'preferences',
    'level',
] as const;

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
        .filter((cmd) => !cmd.data.name.startsWith('_') && (GLOBAL_COMMAND_NAMES as readonly string[]).includes(cmd.data.name))
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
        .filter((cmd) => !cmd.data.name.startsWith('_') && !(GLOBAL_COMMAND_NAMES as readonly string[]).includes(cmd.data.name))
        .map((cmd) => {
            const json = cmd.data.toJSON();
            return { ...json, dm_permission: false };
        });
}
