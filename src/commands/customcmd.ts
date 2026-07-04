import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags, 
    ModalBuilder, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} from 'discord.js';
import type { Command, CustomCommand } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const wizardSessions = new Map<string, any>();

function getSessionKey(userId: string, guildId: string): string {
    return `${userId}-${guildId}`;
}

function renderWizPage(session: any): any {
    const page = session.page;
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);

    let title = `Custom Command Builder • Page ${page}/3`;
    let desc = '';

    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`customcmd_wiz:prev:${page}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId(`customcmd_wiz:next:${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page === 3),
        new ButtonBuilder().setCustomId(`customcmd_wiz:cancel`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
    );

    const actionRows: any[] = [];

    switch (page) {
        case 1:
            desc = `### Page 1: Command Basics\n` +
                `Define the name and default cooldown limits.\n\n` +
                `› **Command Name:** ${session.name ? `**\`${session.name}\`**` : '*Not set (Required)*'} (e.g. "website")\n` +
                `› **Cooldown:** \`${session.cooldown}\` second(s)\n\n` +
                `Press the button below to define these parameters.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('customcmd_wiz:modal:basic').setLabel('Edit Basic Info').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 2:
            desc = `### Page 2: Permissions & Aliases\n` +
                `Bind roles permissions and alternate shortcut aliases.\n\n` +
                `› **Required Roles:** ${session.permissions.length > 0 ? session.permissions.map((r: string) => `<@&${r}>`).join(', ') : '*None (Open to everyone)*'}\n` +
                `› **Aliases:** ${session.aliases.length > 0 ? session.aliases.map((a: string) => `\`${a}\``).join(', ') : '*None*'}\n\n` +
                `Press the button below to configure filters.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('customcmd_wiz:modal:perms').setLabel('Configure Filters').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 3:
            desc = `### Page 3: Response Parameters\n` +
                `Set the reply formatting, type, and variables content.\n\n` +
                `› **Reply Type:** **\`${session.replyType.toUpperCase()}\`**\n` +
                `› **Reply Content:** ${session.replyContent ? `_Configured (${session.replyContent.length} chars)_` : '*Not set (Required)*'}\n\n` +
                `Select a reply formatting type below, then configure the content body.`;

            const typeSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('customcmd_wiz:select:type')
                    .setPlaceholder('Select response format')
                    .addOptions([
                        { label: 'Normal Message Text', value: 'text' },
                        { label: 'System Embed (JSON/V2)', value: 'embed' },
                        { label: 'Image URL Attachment', value: 'image' }
                    ])
            );
            actionRows.push(typeSelect);
            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('customcmd_wiz:modal:response').setLabel('Edit Response Content').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('customcmd_wiz:save').setLabel('Save Command ✅').setStyle(ButtonStyle.Success).setDisabled(!session.name || !session.replyContent)
            ));
            break;
    }

    c.addTextDisplayComponents(ComponentsV2.text(`# ${title}\n\n${desc}`))
        .addSeparatorComponents(ComponentsV2.separator());

    actionRows.forEach(row => c.addActionRowComponents(row));
    c.addActionRowComponents(navRow);

    return c;
}

export const customcmdCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('customcmd')
        .setDescription('Create, inspect, and delete custom commands')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('create').setDescription('Open the premium interactive creation wizard')
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('List all custom commands in this server')
        )
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a custom command')
                .addStringOption(o => o.setName('name').setDescription('Command name').setRequired(true))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);

        if (sub === 'create') {
            const key = getSessionKey(interaction.user.id, interaction.guildId!);
            wizardSessions.set(key, {
                page: 1,
                name: '',
                cooldown: 0,
                aliases: [],
                permissions: [],
                replyType: 'text',
                replyContent: ''
            });

            const container = renderWizPage(wizardSessions.get(key));
            await interaction.reply({
                components: [container],
                flags: V2 | EPH
            });
        }
        else if (sub === 'list') {
            await interaction.deferReply({ flags: EPH });
            const list = await supabase.listCustomCommands(interaction.guildId!);

            if (list.length === 0) {
                await interaction.editReply({
                    components: [ComponentsV2.warningContainer('No Custom Commands', 'Use `/customcmd create` to add custom shortcuts to your guild.')],
                    flags: V2
                });
                return;
            }

            let text = `# 🛠️ Custom Commands List\n\n`;
            list.forEach((c, i) => {
                text += `### \`#${i+1}\` Command: **\`${c.name}\`**\n` +
                    `› **Type:** \`${c.reply_type.toUpperCase()}\` | **Cooldown:** \`${c.cooldown}s\`\n` +
                    (c.aliases && c.aliases.length > 0 ? `› **Aliases:** ${c.aliases.map((a: string) => `\`${a}\``).join(', ')}\n` : '') +
                    `› **Enabled:** \`${c.enabled ? 'Yes' : 'No'}\`\n\n`;
            });

            await interaction.editReply({
                components: [ComponentsV2.baseContainer(ComponentsV2.Accents.primary).addTextDisplayComponents(ComponentsV2.text(text))],
                flags: V2
            });
        }
        else if (sub === 'delete') {
            await interaction.deferReply({ flags: EPH });
            const name = interaction.options.getString('name', true).trim().toLowerCase();

            const cmd = await supabase.getCustomCommand(interaction.guildId!, name);
            if (!cmd) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Not Found', `No custom command named \`${name}\` exists in this server.`)],
                    flags: V2
                });
                return;
            }

            await supabase.deleteCustomCommand(interaction.guildId!, name);
            await interaction.editReply({
                components: [ComponentsV2.successContainer('Deleted', `Custom command **\`${name}\`** has been deleted.`)],
                flags: V2
            });
        }
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('customcmd_wiz:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);
        const session = wizardSessions.get(key);

        if (!session) {
            await interaction.reply({ content: '❌ Session expired.', flags: EPH });
            return;
        }

        const action = interaction.customId.split(':')[1];

        if (action === 'cancel') {
            wizardSessions.delete(key);
            await interaction.update({
                components: [ComponentsV2.warningContainer('Cancelled', 'Custom command creation cancelled.')]
            });
            return;
        }

        if (action === 'prev') {
            session.page = Math.max(1, session.page - 1);
            await interaction.update({ components: [renderWizPage(session)] });
        } 
        else if (action === 'next') {
            session.page = Math.min(3, session.page + 1);
            await interaction.update({ components: [renderWizPage(session)] });
        }
        else if (action === 'modal') {
            const target = interaction.customId.split(':')[2];
            if (target === 'basic') {
                const modal = new ModalBuilder().setCustomId('customcmd_wiz_modal:basic').setTitle('Page 1: Command Basics');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Command Name').setPlaceholder('website').setValue(session.name).setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (Seconds)').setPlaceholder('5').setValue(String(session.cooldown)).setStyle(TextInputStyle.Short).setRequired(false))
                );
                await interaction.showModal(modal);
            } 
            else if (target === 'perms') {
                const modal = new ModalBuilder().setCustomId('customcmd_wiz_modal:perms').setTitle('Page 2: Filters & Shortcuts');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('roles').setLabel('Required Roles IDs (CSV)').setPlaceholder('98273498237492,83274928374982').setValue(session.permissions.join(',')).setStyle(TextInputStyle.Paragraph).setRequired(false)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('aliases').setLabel('Aliases Shortcuts (CSV)').setPlaceholder('site,web').setValue(session.aliases.join(',')).setStyle(TextInputStyle.Short).setRequired(false))
                );
                await interaction.showModal(modal);
            }
            else if (target === 'response') {
                const modal = new ModalBuilder().setCustomId('customcmd_wiz_modal:response').setTitle('Page 3: Response Content');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('content').setLabel('Response Body / Image Link / JSON Embed').setPlaceholder('Visit: https://victuscloud.com\n\nVariables: {user}, {guild}, {member.level}').setValue(session.replyContent).setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                await interaction.showModal(modal);
            }
        }
        else if (action === 'save') {
            try {
                await supabase.createCustomCommand(interaction.guildId!, {
                    name: session.name,
                    cooldown: session.cooldown,
                    aliases: session.aliases,
                    permissions: session.permissions,
                    reply_type: session.replyType,
                    reply_content: session.replyContent,
                    enabled: true
                });

                wizardSessions.delete(key);

                await interaction.update({
                    components: [ComponentsV2.successContainer('Command Saved', `Custom command **\`${session.name}\`** has been registered successfully!`)],
                });
            } catch (error) {
                logger.error('Failed to save custom command:', error);
                await interaction.reply({ content: '❌ System error writing custom command to database.', flags: EPH });
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'customcmd_wiz:select:type') return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);
        const session = wizardSessions.get(key);

        if (!session) return;

        session.replyType = interaction.values[0];
        await interaction.update({ components: [renderWizPage(session)] });
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith('customcmd_wiz_modal:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);
        const session = wizardSessions.get(key);

        if (!session) {
            await interaction.reply({ content: '❌ Session expired.', flags: EPH });
            return;
        }

        const type = interaction.customId.split(':')[1];

        if (type === 'basic') {
            session.name = interaction.fields.getTextInputValue('name').trim().toLowerCase().replace(/\s+/g, '');
            
            const cd = parseInt(interaction.fields.getTextInputValue('cooldown').trim(), 10);
            session.cooldown = isNaN(cd) ? 0 : Math.max(0, cd);
        } 
        else if (type === 'perms') {
            const rInput = interaction.fields.getTextInputValue('roles').trim();
            session.permissions = rInput ? rInput.split(',').map(r => r.trim()).filter(r => r.length > 0) : [];

            const aInput = interaction.fields.getTextInputValue('aliases').trim();
            session.aliases = aInput ? aInput.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0) : [];
        }
        else if (type === 'response') {
            session.replyContent = interaction.fields.getTextInputValue('content').trim();
        }

        await (interaction as any).update({ components: [renderWizPage(session)] });
    }
};
