import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    EmbedBuilder,
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { warnSettings, WarnConfig, WarningRecord } from '../services/warnSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function renderWarnDashboard(config: WarnConfig): any {
    const c = ComponentsV2.baseContainer(config.enabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);
    
    const text = `# ⚠️ Warning System Setup\n` +
        `Configure moderator staff warnings and logging settings.\n\n` +
        `› **Status:** ${config.enabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `› **Warn Logs Channel:** ${config.warnChannelId ? `<#${config.warnChannelId}>` : '*Not configured (Required)*'}\n\n` +
        `*Note: The configured warn channel is protected from deletion and will automatically recreate itself if deleted.*`;
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Select log channel (GuildText)
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('warn_wiz:channel')
            .setPlaceholder('Select warning logs channel...')
            .addChannelTypes(ChannelType.GuildText)
    );
    
    // Row 2: Status Toggle Button
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('warn_wiz:toggle_status')
            .setLabel(config.enabled ? 'Disable Warnings 🔴' : 'Enable Warnings 🟢')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    
    c.addActionRowComponents(channelSelect);
    c.addActionRowComponents(btnRow);
    
    return c;
}

export const warnCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warnings system management')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Warn a server member')
                .addUserOption(opt => opt.setName('user').setDescription('The user to warn').setRequired(true))
                .addStringOption(opt => opt.setName('reason').setDescription('The reason for this warning').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View active warnings for a member')
                .addUserOption(opt => opt.setName('user').setDescription('The user to view warnings for').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a specific warning from a user')
                .addUserOption(opt => opt.setName('user').setDescription('The user to remove warning from').setRequired(true))
                .addStringOption(opt => opt.setName('id').setDescription('The unique Warning ID').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Clear all warnings for a user')
                .addUserOption(opt => opt.setName('user').setDescription('The user to clear warnings for').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the warning system setup dashboard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        const config = await warnSettings.get(interaction.guildId!);

        if (sub === 'setup') {
            const dashboard = renderWarnDashboard(config);
            await interaction.reply({
                components: [dashboard],
                flags: V2 | EPH
            });
            return;
        }

        if (!config.enabled) {
            await interaction.reply({ content: '❌ The warning system is currently disabled on this server.', flags: EPH });
            return;
        }

        const targetUser = interaction.options.getUser('user', true);
        if (targetUser.bot) {
            await interaction.reply({ content: '❌ You cannot warn a bot user.', flags: EPH });
            return;
        }

        if (sub === 'add') {
            const reason = interaction.options.getString('reason', true);
            const warnings = await warnSettings.getWarnings(interaction.guildId!, targetUser.id);
            const warnCount = warnings.length + 1;
            
            const warningId = Math.random().toString(36).slice(2, 8);
            const record: WarningRecord = {
                id: warningId,
                userId: targetUser.id,
                userName: targetUser.username,
                moderatorId: interaction.user.id,
                moderatorName: interaction.user.username,
                reason: reason,
                timestamp: new Date().toISOString()
            };

            await warnSettings.addWarning(interaction.guildId!, targetUser.id, record);

            // 1. Post to warn log channel
            if (config.warnChannelId) {
                const warnChannel = interaction.guild?.channels.cache.get(config.warnChannelId);
                if (warnChannel?.isTextBased()) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0xf59e0b) // Warning Amber
                        .setTitle('⚠️ Member Warned')
                        .setThumbnail(targetUser.displayAvatarURL())
                        .setDescription(
                            `**User:** <@${targetUser.id}> (${targetUser.username})\n` +
                            `**Moderator:** <@${interaction.user.id}>\n` +
                            `**Warning ID:** \`${warningId}\`\n` +
                            `**Reason:** ${reason}\n` +
                            `────────────────────────\n` +
                            `**Warnings Count:** \`${warnCount}\``
                        )
                        .setTimestamp();
                    await (warnChannel as any).send({ embeds: [logEmbed] }).catch(() => {});
                }
            }

            // 2. DM the warned user
            const dmEmbed = new EmbedBuilder()
                .setColor(0xef4444) // Danger Red
                .setTitle('⚠️ Warning Notice')
                .setDescription(
                    `You have been issued a warning in **${interaction.guild?.name}**.\n\n` +
                    `**Reason:** ${reason}\n` +
                    `**Issued By:** ${interaction.user.username}\n` +
                    `────────────────────────\n` +
                    `**Total Warnings:** \`${warnCount}\``
                )
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});

            // 3. Reply to Moderator
            const successEmbed = new EmbedBuilder()
                .setColor(0x10b981) // Success Green
                .setTitle('✅ Warning Issued')
                .setDescription(`Successfully warned <@${targetUser.id}>.\n\n**Warning ID:** \`${warningId}\` | **Total Warns:** \`${warnCount}\``);
            await interaction.reply({ embeds: [successEmbed], flags: EPH });
        }
        else if (sub === 'list') {
            const warnings = await warnSettings.getWarnings(interaction.guildId!, targetUser.id);
            if (warnings.length === 0) {
                const noWarnEmbed = new EmbedBuilder()
                    .setColor(0x3b82f6)
                    .setTitle('ℹ️ No Warnings')
                    .setDescription(`<@${targetUser.id}> currently has no warnings.`);
                await interaction.reply({ embeds: [noWarnEmbed], flags: EPH });
                return;
            }

            const listEmbed = new EmbedBuilder()
                .setColor(0x3b82f6) // Info Blue
                .setTitle(`⚠️ Warnings for ${targetUser.username}`)
                .setDescription(`**Total Active Warnings:** \`${warnings.length}\`\n\n────────────────────────`);
                
            warnings.forEach((w) => {
                listEmbed.addFields({
                    name: `ID: ${w.id} | Moderator: ${w.moderatorName}`,
                    value: `› **Reason:** ${w.reason}\n› **Date:** <t:${Math.floor(new Date(w.timestamp).getTime() / 1000)}:R>`
                });
            });

            await interaction.reply({ embeds: [listEmbed], flags: EPH });
        }
        else if (sub === 'remove') {
            const warnId = interaction.options.getString('id', true);
            const updated = await warnSettings.removeWarning(interaction.guildId!, targetUser.id, warnId);
            if (!updated) {
                await interaction.reply({ content: `❌ Warning ID \`${warnId}\` not found for <@${targetUser.id}>.`, flags: EPH });
                return;
            }

            const successEmbed = new EmbedBuilder()
                .setColor(0x10b981)
                .setTitle('✅ Warning Removed')
                .setDescription(`Removed warning ID \`${warnId}\` from <@${targetUser.id}>.\n\n**Total warnings remaining:** \`${updated.length}\``);
            await interaction.reply({ embeds: [successEmbed], flags: EPH });
        }
        else if (sub === 'reset') {
            await warnSettings.resetWarnings(interaction.guildId!, targetUser.id);
            const successEmbed = new EmbedBuilder()
                .setColor(0x10b981)
                .setTitle('✅ Warnings Cleared')
                .setDescription(`Successfully cleared all warnings for <@${targetUser.id}>.`);
            await interaction.reply({ embeds: [successEmbed], flags: EPH });
        }
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('warn_wiz:')) return;
        const config = await warnSettings.get(interaction.guildId!);
        const action = interaction.customId.split(':')[1];

        if (action === 'toggle_status') {
            const updated = await warnSettings.set(interaction.guildId!, { enabled: !config.enabled });
            await interaction.update({ components: [renderWarnDashboard(updated)] });
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'warn_wiz:channel') return;
        const warnChannelId = interaction.values[0];
        const updated = await warnSettings.set(interaction.guildId!, { warnChannelId });
        await interaction.update({ components: [renderWarnDashboard(updated)] });
    }
};
