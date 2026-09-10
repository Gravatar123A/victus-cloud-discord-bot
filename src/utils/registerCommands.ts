import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { getGlobalCommandData, getGuildCommandData, getCommandData } from '../commands/index.js';
import { logger } from './logger.js';

/**
 * Sync slash commands with Discord.
 *
 * We register commands meant to work in DMs globally (with dm_permission: true),
 * and register server-only commands as guild-specific commands (with dm_permission: false).
 * This completely prevents duplicate autocomplete registrations in Discord.
 */
export async function registerApplicationCommands(source = 'startup'): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const globalCommands = getGlobalCommandData();
    const guildCommands = getGuildCommandData();
    const totalCount = globalCommands.length + guildCommands.length;

    logger.info(`Syncing Discord slash commands (${source}):`);
    logger.info(`  → Total loaded commands: ${totalCount}`);
    logger.info(`  → Global scope (DM enabled): ${globalCommands.length} commands`);
    logger.info(`  → Guild scope (Server-only): ${guildCommands.length} commands`);

    // 1) Global registration — only for global commands
    if (globalCommands.length > 0) {
        try {
            await rest.put(Routes.applicationCommands(config.discord.clientId), { body: globalCommands });
            logger.info(`✅ Synced ${globalCommands.length} global commands.`);
        } catch (error) {
            logger.error('❌ Global command sync failed:', error);
        }
    } else {
        try {
            await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });
            logger.info('✅ Cleared all global commands.');
        } catch (error) {
            logger.error('❌ Failed to clear global commands:', error);
        }
    }

    // 2) Guild registration — only for server-only commands
    const instantGuilds = [config.discord.guildId, config.bot.supportGuildId].filter(
        (g, i, arr): g is string => !!g && arr.indexOf(g) === i,
    );

    if (instantGuilds.length > 0) {
        for (const guildId of instantGuilds) {
            if (guildCommands.length > 0) {
                try {
                    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: guildCommands });
                    logger.info(`✅ Synced ${guildCommands.length} guild commands instantly to guild ${guildId}.`);
                } catch (error) {
                    logger.error(`❌ Guild command sync failed for ${guildId}:`, error);
                }
            } else {
                try {
                    await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: [] });
                    logger.info(`✅ Cleared all guild commands for ${guildId}.`);
                } catch (error) {
                    logger.error(`❌ Failed to clear guild commands for ${guildId}:`, error);
                }
            }
        }
    } else {
        logger.warn(
            '⚠️ No DISCORD_GUILD_ID / DISCORD_SUPPORT_GUILD_ID set — server-only commands will not be registered anywhere. Set a guild ID for instant updates.',
        );
    }
}
