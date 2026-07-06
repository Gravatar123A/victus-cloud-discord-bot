import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder,
    EmbedBuilder
} from 'discord.js';
import type { Command } from '../types/index.js';
import { whitelistSettings, WhitelistRecord, WhitelistConfig } from '../services/whitelistSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const IMMUNITY_OPTIONS = [
    { label: 'Ban Immunity', value: 'ban', description: 'Prevent user from being banned' },
    { label: 'Kick Immunity', value: 'kick', description: 'Prevent user from being kicked' },
    { label: 'Timeout/Mute Immunity', value: 'timeout', description: 'Prevent user from being timed out' },
    { label: 'Warning Immunity', value: 'warn', description: 'Prevent user from receiving warnings' }
];

function renderWhitelistEditor(record: WhitelistRecord): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);

    const activeList = record.categories.length > 0
        ? record.categories.map(cat => {
            const opt = IMMUNITY_OPTIONS.find(o => o.value === cat);
            return `• **${opt?.label || cat}**`;
        }).join('\n')
        : '_No immunities selected (Currently has no protections)_';

    const text = `# 🛡️ Whitelist Editor: ${record.userName}\n` +
        `Configure immunity status and action bypasses for this member.\n\n` +
        `› **User:** <@${record.userId}> (\`${record.userId}\`)\n` +
        `› **Added By:** <@${record.addedBy}>\n\n` +
        `### Active Immunities:\n${activeList}`;

    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());

    // Category multi-select
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`whitelist:select:${record.userId}`)
            .setPlaceholder('Select immunities to assign...')
            .setMinValues(1)
            .setMaxValues(IMMUNITY_OPTIONS.length)
            .addOptions(IMMUNITY_OPTIONS.map(opt => ({
                ...opt,
                default: record.categories.includes(opt.value)
            })))
    );

    // Save/Close Buttons
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`whitelist:save:${record.userId}`)
            .setLabel('Save Settings ✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`whitelist:remove_btn:${record.userId}`)
            .setLabel('Remove Whitelist 🗑️')
            .setStyle(ButtonStyle.Danger)
    );

    c.addActionRowComponents(selectRow);
    c.addActionRowComponents(btnRow);

    return c;
}

export const whitelistCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Manage server bypasses and member immunities')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => 
            sub.setName('add')
                .setDescription('Add a user to the whitelist')
                .addUserOption(opt => 
                    opt.setName('user')
                        .setDescription('The user to whitelist')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => 
            sub.setName('remove')
                .setDescription('Remove a user from the whitelist')
                .addUserOption(opt => 
                    opt.setName('user')
                        .setDescription('The user to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => 
            sub.setName('edit')
                .setDescription('Edit a whitelisted user\'s immunities')
                .addUserOption(opt => 
                    opt.setName('user')
                        .setDescription('The user to edit')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => 
            sub.setName('list')
                .setDescription('List all whitelisted users and their immunities')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        const config = await whitelistSettings.get(interaction.guildId!);
        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        if (sub === 'add') {
            const user = interaction.options.getUser('user', true);

            let record = config.users.find(u => u.userId === user.id);
            if (!record) {
                record = {
                    userId: user.id,
                    userName: user.username,
                    categories: ['ban', 'kick', 'timeout', 'warn'], // Default all immunities on first add
                    addedBy: interaction.user.id,
                    timestamp: new Date().toISOString()
                };
                config.users.push(record);
                await whitelistSettings.set(interaction.guildId!, config);
            }

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ Whitelist Added')
                    .setDescription(`Added **${user.username}** to the whitelist with all bypasses.`);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [renderWhitelistEditor(record)],
                    flags: V2 | EPH
                });
            }
        }
        else if (sub === 'edit') {
            const user = interaction.options.getUser('user', true);
            const record = config.users.find(u => u.userId === user.id);

            if (!record) {
                const err = '❌ This user is not currently whitelisted.';
                if (isPrefix) {
                    await interaction.reply({ content: err });
                } else {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Not Whitelisted', err)],
                        flags: V2 | EPH
                    });
                }
                return;
            }

            if (isPrefix) {
                await interaction.reply({ content: '❌ Whitelist editor dashboard is only supported via slash commands.' });
            } else {
                await interaction.reply({
                    components: [renderWhitelistEditor(record)],
                    flags: V2 | EPH
                });
            }
        }
        else if (sub === 'remove') {
            const user = interaction.options.getUser('user', true);
            const exists = config.users.some(u => u.userId === user.id);

            if (!exists) {
                const err = '❌ This user is not currently whitelisted.';
                if (isPrefix) {
                    await interaction.reply({ content: err });
                } else {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Not Whitelisted', err)],
                        flags: V2 | EPH
                    });
                }
                return;
            }

            config.users = config.users.filter(u => u.userId !== user.id);
            await whitelistSettings.set(interaction.guildId!, config);

            const successMsg = `Successfully removed **${user.username}** from the whitelist.`;

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('✅ Whitelist Removed')
                    .setDescription(successMsg);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({
                    components: [ComponentsV2.successContainer('Whitelist Removed', successMsg)],
                    flags: V2 | EPH
                });
            }
        }
        else if (sub === 'list') {
            if (config.users.length === 0) {
                const err = '❌ No users are currently whitelisted on this server.';
                if (isPrefix) {
                    await interaction.reply({ content: err });
                } else {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Empty List', err)],
                        flags: V2 | EPH
                    });
                }
                return;
            }

            let desc = '';
            config.users.forEach((u, idx) => {
                const cats = u.categories.length > 0 
                    ? u.categories.map(c => `\`${c.toUpperCase()}\``).join(', ')
                    : '`NONE`';
                desc += `\`${idx + 1}.\` <@${u.userId}> — bypasses: ${cats}\n`;
            });

            if (isPrefix) {
                const embed = new EmbedBuilder()
                    .setColor(0x2b2d31)
                    .setTitle('🛡️ Server Whitelists')
                    .setDescription(desc)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } else {
                const listCard = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
                listCard.addTextDisplayComponents(ComponentsV2.text(`# 🛡️ Server Whitelists\n\n${desc}`));
                await interaction.reply({
                    components: [listCard],
                    flags: V2 | EPH
                });
            }
        }
    },

    async handleButton(interaction) {
        const guildId = interaction.guildId!;
        const action = interaction.customId.split(':')[1];
        const targetId = interaction.customId.split(':')[2];

        const config = await whitelistSettings.get(guildId);
        const record = config.users.find(u => u.userId === targetId);

        if (!record) {
            await interaction.reply({ content: '❌ Whitelist record not found.', flags: EPH });
            return;
        }

        if (action === 'save') {
            await interaction.update({
                components: [ComponentsV2.successContainer('Settings Saved', `Successfully updated whitelist settings for **${record.userName}**.`)],
                embeds: []
            });
        }
        else if (action === 'remove_btn') {
            const updatedUsers = config.users.filter(u => u.userId !== targetId);
            await whitelistSettings.set(guildId, { users: updatedUsers });
            await interaction.update({
                components: [ComponentsV2.successContainer('Whitelist Removed', `Removed **${record.userName}** from the whitelist.`)],
                embeds: []
            });
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('whitelist:select:')) return;
        const targetId = interaction.customId.split(':')[2];
        const guildId = interaction.guildId!;

        const config = await whitelistSettings.get(guildId);
        const record = config.users.find(u => u.userId === targetId);

        if (record) {
            record.categories = interaction.values;
            await whitelistSettings.set(guildId, config);

            await interaction.update({
                components: [renderWhitelistEditor(record)],
                embeds: []
            });
        }
    }
};
