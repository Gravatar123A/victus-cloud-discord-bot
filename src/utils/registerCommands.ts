import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { getCommandData } from '../commands/index.js';
import { logger } from './logger.js';

/**
 * Sync slash commands with Discord.
 *
 * We register GLOBALLY (so every server the bot is in eventually gets the
 * commands) AND mirror to the configured primary/support guild(s) as guild
 * commands. Guild commands appear instantly and override the global copy of the
 * same name, so new commands show up immediately in the main server instead of
 * waiting up to an hour for global propagation. This is what makes freshly
 * added commands actually load.
 */
export async function registerApplicationCommands(source = 'startup'): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const commandData = getCommandData();

    logger.info(`Syncing ${commandData.length} Discord slash commands (${source})...`);

    // 1) Global registration — covers every guild (propagation up to ~1h for NEW commands).
    try {
        await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commandData });
        logger.info(`✅ Synced ${commandData.length} slash commands globally.`);
    } catch (error) {
        logger.error('❌ Global slash command sync failed:', error);
    }

    // 2) Instant mirror to the primary + support guilds (deduped) for immediate availability.
    const instantGuilds = [config.discord.guildId, config.bot.supportGuildId].filter(
        (g, i, arr): g is string => !!g && arr.indexOf(g) === i,
    );

    for (const guildId of instantGuilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: commandData });
            logger.info(`✅ Synced slash commands instantly to guild ${guildId}.`);
        } catch (error) {
            logger.error(`❌ Guild slash command sync failed for ${guildId}:`, error);
        }
    }

    if (!instantGuilds.length) {
        logger.warn(
            '⚠️ No DISCORD_GUILD_ID / DISCORD_SUPPORT_GUILD_ID set — only global sync was done, so NEW commands can take up to ~1 hour to appear. Set a guild ID for instant updates.',
        );
    }
}
