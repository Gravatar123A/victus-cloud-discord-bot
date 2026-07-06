import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { auditLogSettings, AuditLogConfig } from '../services/auditLogSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const EVENTS_OPTIONS = [
    { label: 'Message Edits', value: 'message_edit', description: 'Log when messages are edited' },
    { label: 'Message Deletions', value: 'message_delete', description: 'Log when messages are deleted' },
    { label: 'Member Joins', value: 'member_join', description: 'Log when new members join the server' },
    { label: 'Member Leaves', value: 'member_leave', description: 'Log when members leave the server' },
    { label: 'Server Bans', value: 'ban', description: 'Log when members are banned' },
    { label: 'Server Unbans', value: 'unban', description: 'Log when member bans are removed' }
];

function renderAuditLogDashboard(config: AuditLogConfig): any {
    const c = ComponentsV2.baseContainer(config.enabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);

    const activeEventsList = config.events && config.events.length > 0
        ? config.events.map(ev => {
            const opt = EVENTS_OPTIONS.find(o => o.value === ev);
            return `• **${opt?.label || ev}**`;
        }).join('\n')
        : '_No events selected (Logging suspended)_';

    const text = `# 📜 Server Audit Log System\n` +
        `Track moderator actions, member updates, and message logs in a designated logs channel.\n\n` +
        `› **Status:** ${config.enabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `› **Log Channel:** ${config.channelId ? `<#${config.channelId}>` : '*Not configured (Required)*'}\n\n` +
        `### Active Logging Events:\n${activeEventsList}`;

    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());

    // Row 1: Channel select menu
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('audit_log:channel')
            .setPlaceholder('Select logging text channel...')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );

    // Row 2: Events multi-select string select menu
    const eventsSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('audit_log:events')
            .setPlaceholder('Select events to log...')
            .setMinValues(1)
            .setMaxValues(EVENTS_OPTIONS.length)
            .addOptions(EVENTS_OPTIONS.map(opt => ({
                ...opt,
                default: config.events.includes(opt.value)
            })))
    );

    // Row 3: Status Toggle Button
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('audit_log:toggle')
            .setLabel(config.enabled ? 'Disable Audit Logs 🔴' : 'Enable Audit Logs 🟢')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    c.addActionRowComponents(channelSelect);
    c.addActionRowComponents(eventsSelect);
    c.addActionRowComponents(btnRow);

    return c;
}

export const auditLogCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('audit-log')
        .setDescription('Configure server audit logging options')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the audit log configuration dashboard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        if (sub === 'setup') {
            const config = await auditLogSettings.get(interaction.guildId!);
            const dashboard = renderAuditLogDashboard(config);
            await interaction.reply({
                components: [dashboard],
                flags: V2 | EPH
            });
        }
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'audit_log:toggle') return;
        const config = await auditLogSettings.get(interaction.guildId!);
        const updated = await auditLogSettings.set(interaction.guildId!, { enabled: !config.enabled });
        await interaction.update({
            components: [renderAuditLogDashboard(updated)],
            embeds: []
        });
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('audit_log:')) return;
        const action = interaction.customId.split(':')[1];
        const config = await auditLogSettings.get(interaction.guildId!);

        if (action === 'channel') {
            const val = interaction.values[0];
            const updated = await auditLogSettings.set(interaction.guildId!, { channelId: val });
            await interaction.update({
                components: [renderAuditLogDashboard(updated)],
                embeds: []
            });
        } else if (action === 'events') {
            const val = interaction.values;
            const updated = await auditLogSettings.set(interaction.guildId!, { events: val });
            await interaction.update({
                components: [renderAuditLogDashboard(updated)],
                embeds: []
            });
        }
    }
};
