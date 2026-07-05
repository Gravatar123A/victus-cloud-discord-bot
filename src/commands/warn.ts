import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    User 
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
                    const logCard = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
                    logCard.addTextDisplayComponents(ComponentsV2.text(
                        `# ⚠️ Member Warned\n` +
                        `› **User:** <@${targetUser.id}> (${targetUser.username})\n` +
                        `› **Moderator:** <@${interaction.user.id}>\n` +
                        `› **Warning ID:** \`${warningId}\`\n` +
                        `› **Reason:** ${reason}\n` +
                        `› **Warnings Count:** \`${warnCount}\``
                    ));
                    await (warnChannel as any).send({ components: [logCard], flags: V2 }).catch(() => {});
                }
            }

            // 2. DM the warned user
            const dmCard = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            dmCard.addTextDisplayComponents(ComponentsV2.text(
                `# ⚠️ Warning Notice\n` +
                `You have been issued a warning in **${interaction.guild?.name}**.\n\n` +
                `› **Reason:** ${reason}\n` +
                `› **Issued By:** ${interaction.user.username}\n` +
                `› **Total Warnings:** \`${warnCount}\``
            ));
            await targetUser.send({ components: [dmCard], flags: V2 }).catch(() => {});

            // 3. Reply to Moderator
            await interaction.reply({
                components: [ComponentsV2.successContainer('Warning Issued', `Warned <@${targetUser.id}> successfully (Warning ID: \`${warningId}\`, Total: \`${warnCount}\`).`)],
                flags: V2 | EPH
            });
        }
        else if (sub === 'list') {
            const warnings = await warnSettings.getWarnings(interaction.guildId!, targetUser.id);
            if (warnings.length === 0) {
                await interaction.reply({
                    components: [ComponentsV2.infoContainer('No Warnings', `<@${targetUser.id}> currently has no warnings.`)],
                    flags: V2 | EPH
                });
                return;
            }

            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
            let text = `# ⚠️ Warnings for ${targetUser.username}\n` +
                `› **Total Warnings:** \`${warnings.length}\`\n\n` +
                `---`;
                
            warnings.forEach((w) => {
                text += `\n\n**ID:** \`${w.id}\` | **Moderator:** <@${w.moderatorId}>\n` +
                    `› **Reason:** ${w.reason}\n` +
                    `› **Date:** <t:${Math.floor(new Date(w.timestamp).getTime() / 1000)}:R>`;
            });

            c.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [c], flags: V2 | EPH });
        }
        else if (sub === 'remove') {
            const warnId = interaction.options.getString('id', true);
            const updated = await warnSettings.removeWarning(interaction.guildId!, targetUser.id, warnId);
            if (!updated) {
                await interaction.reply({ content: `❌ Warning ID \`${warnId}\` not found for <@${targetUser.id}>.`, flags: EPH });
                return;
            }

            await interaction.reply({
                components: [ComponentsV2.successContainer('Warning Removed', `Removed warning ID \`${warnId}\` from <@${targetUser.id}>. (Total warnings remaining: \`${updated.length}\`)`)],
                flags: V2 | EPH
            });
        }
        else if (sub === 'reset') {
            await warnSettings.resetWarnings(interaction.guildId!, targetUser.id);
            await interaction.reply({
                components: [ComponentsV2.successContainer('Warnings Cleared', `Successfully cleared all warnings for <@${targetUser.id}>.`)],
                flags: V2 | EPH
            });
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
