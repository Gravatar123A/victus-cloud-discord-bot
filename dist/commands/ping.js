import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { Icons } from '../utils/premium.js';
import { logger } from '../utils/logger.js';
const V2 = ComponentsV2.IS_COMPONENTS_V2;
const ICE_ACCENT = 0x89CFF0; // Pastel/Ice aesthetic accent color
const REFRESH_CUSTOM_ID = 'ping:refresh';
/**
 * Builds the latency telemetry container with pastel/ice aesthetic.
 */
function buildPingContainer(wsPing, apiLatency, isRefreshed = false) {
    const statusSignal = wsPing < 150 ? 'Optimal' : wsPing < 300 ? 'Normal' : 'Elevated';
    const statusEmoji = wsPing < 150 ? '🟢' : wsPing < 300 ? '🟡' : '🟠';
    const body = `${ComponentsV2.panelTitle('🏓 Pong!', 'LATENCY TELEMETRY')}\n\n` +
        `**${Icons.network} WebSocket Heartbeat:** \`${wsPing}ms\`\n` +
        `**${Icons.activity} Round-trip API:** \`${apiLatency}ms\`\n` +
        `**${Icons.node} Connection Status:** ${statusEmoji} \`${statusSignal}\`` +
        (isRefreshed ? `\n\n-# ↻ Last refreshed <t:${Math.floor(Date.now() / 1000)}:R>` : '');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(REFRESH_CUSTOM_ID)
        .setLabel('Refresh Latency')
        .setStyle(ButtonStyle.Secondary));
    return ComponentsV2.baseContainer(ICE_ACCENT)
        .addTextDisplayComponents(ComponentsV2.text(body))
        .addSeparatorComponents(ComponentsV2.separator())
        .addActionRowComponents(row)
        .addTextDisplayComponents(ComponentsV2.footerNote('Victus Cloud Network • High-speed gateway latency'));
}
export const pingCommand = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Measure connection latency to the Victus Cloud gateway')
        .setDMPermission(true),
    cooldown: 3,
    async execute(interaction) {
        const start = Date.now();
        const reply = await interaction.deferReply({ flags: V2, fetchReply: true }).catch(() => null);
        const wsPing = Math.max(0, interaction.client.ws.ping);
        const apiLatency = reply
            ? Math.max(0, reply.createdTimestamp - interaction.createdTimestamp)
            : Math.max(0, Date.now() - start);
        const container = buildPingContainer(wsPing, apiLatency);
        await interaction.editReply({
            components: [container],
            flags: V2,
        });
    },
    async handleButton(interaction) {
        if (interaction.customId !== REFRESH_CUSTOM_ID)
            return;
        try {
            const start = Date.now();
            await interaction.deferUpdate();
            const wsPing = Math.max(0, interaction.client.ws.ping);
            const apiLatency = Math.max(0, Date.now() - start);
            const container = buildPingContainer(wsPing, apiLatency, true);
            await interaction.editReply({
                components: [container],
                flags: V2,
            });
        }
        catch (error) {
            logger.error('Error handling ping refresh button:', error);
        }
    },
};
