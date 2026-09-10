import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';
import { logger } from '../utils/logger.js';
// Pastel / Ice Aesthetic Palette
const ICE_PALETTE = {
    frost: 0x7dd3fc, // Soft Sky / Ice Blue
    glacier: 0x38bdf8, // Vivid Ice
    deepGlacier: 0x0284c7, // Accent Blue
    unauthorized: 0xf87171, // Soft Pastel Red
};
const REFRESH_CUSTOM_ID = 'ping_admin:refresh';
/**
 * Format raw seconds into a clean human-readable uptime string
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const segments = [];
    if (days > 0)
        segments.push(`${days}d`);
    if (hours > 0)
        segments.push(`${hours}h`);
    if (minutes > 0)
        segments.push(`${minutes}m`);
    segments.push(`${secs}s`);
    return segments.join(' ');
}
/**
 * Convert bytes to a formatted megabytes string
 */
function toMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
/**
 * Authorize the invoking user using the bot's tiered permission architecture:
 * 1. Super Owner: Bot Application Owner / Team Member or Support Guild Owner
 * 2. Added Owners: Support Guild Administrators, Supabase platform admins, or ticket_admin roles
 * 3. Junior Admins: ticket_staff roles or Antigravity staff roles
 */
async function verifyTieredPermissions(interaction) {
    const userId = interaction.user.id;
    // 1. Check Discord Application Owner / Team Member (Super Owner)
    try {
        const app = interaction.client.application;
        const application = typeof app?.fetch === 'function' ? await app.fetch().catch(() => app) : app;
        const owner = application?.owner || app?.owner;
        if (owner) {
            if ('id' in owner && owner.id === userId) {
                return { authorized: true, tierName: '👑 Super Owner (Application Owner)' };
            }
            if ('members' in owner) {
                const teamMembers = owner.members;
                if (teamMembers?.has?.(userId)) {
                    return { authorized: true, tierName: '👑 Super Owner (Team)' };
                }
            }
        }
    }
    catch (err) {
        logger.debug('[PingAdmin] Error fetching application owner:', err);
    }
    // Identify target guild for role/permission evaluation
    const supportGuildId = config.bot.supportGuildId || config.discord.guildId;
    if (supportGuildId) {
        const guild = await interaction.client.guilds.fetch(supportGuildId).catch(() => null);
        if (guild) {
            // Guild Owner (Super Owner)
            if (guild.ownerId === userId) {
                return { authorized: true, tierName: '👑 Super Owner (Guild Owner)' };
            }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
                // Guild Administrator (Added Owner)
                if (member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return { authorized: true, tierName: '🛡️ Added Owner (Guild Administrator)' };
                }
                // Check Database Bot Settings for Staff & Admin Roles
                const settings = await supabase.getBotSettings(guild.id).catch(() => null);
                const adminRoleIds = (settings?.ticket_admin_role_ids || []);
                const staffRoleIds = (settings?.ticket_staff_role_ids || []);
                const antigravityStaffRoles = config.antigravity.staffRoleIds || [];
                // Added Owner via Admin Role
                if (adminRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
                    return { authorized: true, tierName: '🛡️ Added Owner (Admin Role)' };
                }
                // Junior Admin via Staff Roles
                const combinedJuniorRoles = [...staffRoleIds, ...antigravityStaffRoles];
                if (combinedJuniorRoles.some((roleId) => member.roles.cache.has(roleId))) {
                    return { authorized: true, tierName: '⚡ Junior Admin (Staff Role)' };
                }
            }
        }
    }
    // Supabase Platform Admin check (Added Owner)
    try {
        const isPlatformAdmin = await supabase.isUserAdmin(userId).catch(() => false);
        if (isPlatformAdmin) {
            return { authorized: true, tierName: '🛡️ Added Owner (Platform Admin)' };
        }
    }
    catch (err) {
        logger.debug('[PingAdmin] Error checking Supabase admin:', err);
    }
    return { authorized: false };
}
function buildRefreshRow() {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(REFRESH_CUSTOM_ID)
        .setLabel('Refresh Diagnostics')
        .setStyle(ButtonStyle.Secondary));
}
function createDiagnosticsEmbed(tierName, wsDisplay, apiLatency, formattedUptime, restartTimestamp, rssFormatted, heapUsedFormatted, heapTotalFormatted, guildCount, memberCount, shardInfo, isRefreshed = false) {
    const nodeVersion = process.version;
    const platformArch = `${process.platform} (${process.arch})`;
    return new EmbedBuilder()
        .setColor(ICE_PALETTE.glacier)
        .setAuthor({
        name: `${config.branding.name} • Admin Diagnostic Suite`,
        iconURL: config.branding.logo,
    })
        .setTitle('❄️ Core System Telemetry')
        .setDescription(`-# Operational state verified • Access granted to **${tierName}**\n\n` +
        `### 🏓 Latency & Network\n` +
        `> **WebSocket Ping:** \`${wsDisplay}\`\n` +
        `> **Round-Trip API:** \`${apiLatency}ms\`\n` +
        `> **Shard Context:** \`${shardInfo}\`\n\n` +
        `### ⏱️ Runtime & Lifecycle\n` +
        `> **Process Uptime:** \`${formattedUptime}\`\n` +
        `> **Last Restart:** <t:${restartTimestamp}:F> (<t:${restartTimestamp}:R>)\n` +
        `> **Runtime Engine:** \`Node.js ${nodeVersion}\` on \`${platformArch}\`\n\n` +
        `### 💾 Memory & Resources\n` +
        `> **Heap Allocated:** \`${heapUsedFormatted}\` / \`${heapTotalFormatted}\`\n` +
        `> **Resident Set (RSS):** \`${rssFormatted}\`\n\n` +
        `### 🌐 Guilds & Reach\n` +
        `> **Total Servers:** \`${guildCount.toLocaleString()}\`\n` +
        `> **Cached / Tracked Users:** \`${memberCount.toLocaleString()}\`` +
        (isRefreshed ? `\n\n-# ↻ Last refreshed <t:${Math.floor(Date.now() / 1000)}:R>` : ''))
        .setFooter({
        text: `Victus Cloud Security • ${tierName}`,
        iconURL: config.branding.logo,
    })
        .setTimestamp();
}
export const pingAdminCommand = {
    data: new SlashCommandBuilder()
        .setName('ping-admin')
        .setDescription('Extended bot diagnostics and performance metrics (Staff DM-only)')
        .setDMPermission(true),
    cooldown: 5,
    async execute(interaction) {
        // 1. DM-only check
        if (interaction.guildId !== null) {
            await interaction.reply({
                content: '🔒 **Direct Messages Only**: `/ping-admin` contains internal diagnostics and can only be used in DMs with the bot.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 2. Tiered Permission Check (Super Owner / Added Owners / Junior Admins)
        const auth = await verifyTieredPermissions(interaction);
        if (!auth.authorized) {
            await interaction.reply({
                content: '⛔ **Not Authorized**: You do not have permission to access staff diagnostics. This incident has been logged.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 3. Extended Diagnostics Measurement
        try {
            // Initial placeholder message to measure round-trip latency
            const initialEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.frost)
                .setDescription('❄️ *Gathering kernel telemetry & process diagnostics...*');
            const sent = await interaction.reply({
                embeds: [initialEmbed],
                fetchReply: true,
            });
            // WebSocket Latency
            const wsPing = interaction.client.ws.ping;
            const wsDisplay = wsPing < 0 ? 'Connecting...' : `${wsPing}ms`;
            // Round-Trip Latency
            const apiLatency = Math.max(0, sent.createdTimestamp - interaction.createdTimestamp);
            // Bot Uptime & Restart calculation
            const uptimeSeconds = process.uptime();
            const formattedUptime = formatUptime(uptimeSeconds);
            const restartTimestamp = Math.floor((Date.now() - uptimeSeconds * 1000) / 1000);
            // Memory Usage
            const memory = process.memoryUsage();
            const rssFormatted = toMB(memory.rss);
            const heapUsedFormatted = toMB(memory.heapUsed);
            const heapTotalFormatted = toMB(memory.heapTotal);
            // Guilds & Members Count
            const guildCount = interaction.client.guilds.cache.size;
            const memberCount = interaction.client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
            // Sharding Details
            const shard = interaction.client.shard;
            const shardInfo = shard
                ? `Shard #${shard.ids.join(', ')} of ${shard.count}`
                : 'Standalone process (Unsharded)';
            // Construct Extended Diagnostics Embed with Pastel/Ice Theme
            const diagnosticsEmbed = createDiagnosticsEmbed(auth.tierName || 'Staff Member', wsDisplay, apiLatency, formattedUptime, restartTimestamp, rssFormatted, heapUsedFormatted, heapTotalFormatted, guildCount, memberCount, shardInfo);
            await interaction.editReply({
                embeds: [diagnosticsEmbed],
                components: [buildRefreshRow()],
            });
        }
        catch (error) {
            logger.error('[PingAdmin] Error generating diagnostic report:', error);
            const errEmbed = new EmbedBuilder()
                .setColor(ICE_PALETTE.unauthorized)
                .setTitle('❌ Diagnostic Collection Failed')
                .setDescription('An unexpected error occurred while compiling system telemetry.');
            await interaction.editReply({ embeds: [errEmbed] }).catch(() => { });
        }
    },
    async handleButton(interaction) {
        if (interaction.customId !== REFRESH_CUSTOM_ID)
            return;
        try {
            // Verify permission again on button interaction
            const auth = await verifyTieredPermissions(interaction);
            if (!auth.authorized) {
                await interaction.reply({
                    content: '⛔ **Not Authorized**: You do not have permission to refresh staff diagnostics.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const start = Date.now();
            await interaction.deferUpdate();
            const wsPing = interaction.client.ws.ping;
            const wsDisplay = wsPing < 0 ? 'Connecting...' : `${wsPing}ms`;
            const apiLatency = Math.max(0, Date.now() - start);
            const uptimeSeconds = process.uptime();
            const formattedUptime = formatUptime(uptimeSeconds);
            const restartTimestamp = Math.floor((Date.now() - uptimeSeconds * 1000) / 1000);
            const memory = process.memoryUsage();
            const rssFormatted = toMB(memory.rss);
            const heapUsedFormatted = toMB(memory.heapUsed);
            const heapTotalFormatted = toMB(memory.heapTotal);
            const guildCount = interaction.client.guilds.cache.size;
            const memberCount = interaction.client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
            const shard = interaction.client.shard;
            const shardInfo = shard
                ? `Shard #${shard.ids.join(', ')} of ${shard.count}`
                : 'Standalone process (Unsharded)';
            const diagnosticsEmbed = createDiagnosticsEmbed(auth.tierName || 'Staff Member', wsDisplay, apiLatency, formattedUptime, restartTimestamp, rssFormatted, heapUsedFormatted, heapTotalFormatted, guildCount, memberCount, shardInfo, true);
            await interaction.editReply({
                embeds: [diagnosticsEmbed],
                components: [buildRefreshRow()],
            });
        }
        catch (error) {
            logger.error('[PingAdmin] Error handling refresh button:', error);
        }
    },
};
