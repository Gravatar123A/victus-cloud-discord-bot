import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    MessageFlags, 
    ModalBuilder, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { welcomeSettings, WelcomeConfig } from '../services/welcomeSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function renderWelcomeDashboard(config: WelcomeConfig): any {
    const c = ComponentsV2.baseContainer(config.enabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);
    
    let text = `# 💠 Welcome System Configuration\n` +
        `Configure how the bot welcomes new server members.\n\n` +
        `› **Status:** ${config.enabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `› **Welcome Channel:** ${config.channelId ? `<#${config.channelId}>` : '*Not configured (Required)*'}\n` +
        `› **Embed Format:** ${config.embedEnabled ? '✨ **Rich Embed**' : '📝 **Text Only**'}\n` +
        `› **Message Template:**\n` +
        `\`\`\`\n${config.template}\n\`\`\`\n`;
        
    if (config.embedEnabled) {
        text += `### 🎨 Embed Settings\n` +
            `› **Embed Title:** \`${config.embedTitle}\`\n` +
            `› **Color HEX:** \`${config.embedColor}\`\n` +
            `› **Banner Image:** ${config.embedImage ? `[Link](${config.embedImage})` : '*None*'}\n`;
    }
    
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Channel selection (native Channel Select Menu)
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('welcome_wiz:channel')
            .setPlaceholder('Select welcome text channel...')
            .addChannelTypes(ChannelType.GuildText)
    );
    
    // Row 2: Toggles
    const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('welcome_wiz:toggle_status')
            .setLabel(config.enabled ? 'Disable System 🔴' : 'Enable System 🟢')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('welcome_wiz:toggle_embed')
            .setLabel(config.embedEnabled ? 'Embed: ON ✨' : 'Embed: OFF 📝')
            .setStyle(config.embedEnabled ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    
    // Row 3: Modals and Actions
    const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('welcome_wiz:modal:msg')
            .setLabel('Edit Message')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('welcome_wiz:modal:embed')
            .setLabel('Edit Embed Style')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!config.embedEnabled),
        new ButtonBuilder()
            .setCustomId('welcome_wiz:test')
            .setLabel('Send Test Welcome 🧪')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!config.channelId)
    );
    
    c.addActionRowComponents(channelSelect);
    c.addActionRowComponents(toggleRow);
    c.addActionRowComponents(editRow);
    
    return c;
}

export function formatWelcomeMessage(template: string, member: any): string {
    const guild = member.guild;
    return template
        .replace(/{user}/g, `<@${member.user.id}>`)
        .replace(/{user\.name}/g, member.user.username)
        .replace(/{guild}/g, guild.name)
        .replace(/{member_count}/g, String(guild.memberCount));
}

export function buildWelcomePayload(config: WelcomeConfig, member: any): any {
    const textBody = formatWelcomeMessage(config.template, member);
    
    if (!config.embedEnabled) {
        return { content: textBody };
    }
    
    const parsedColor = parseInt(config.embedColor.replace('#', ''), 16) || ComponentsV2.Accents.primary;
    const c = ComponentsV2.baseContainer(parsedColor);
    
    if (config.embedImage) {
        c.addMediaGalleryComponents(ComponentsV2.mediaGallery(config.embedImage));
    }
    
    const title = formatWelcomeMessage(config.embedTitle, member);
    c.addTextDisplayComponents(ComponentsV2.text(`# ${title}\n\n${textBody}`));
    
    return { components: [c], flags: V2 };
}

export const welcomeCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure and test the server welcome system')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Open the welcome system settings wizard')
        )
        .addSubcommand(sub =>
            sub.setName('test').setDescription('Send a test welcome greeting message to the configured channel')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        const config = await welcomeSettings.get(interaction.guildId!);

        if (sub === 'setup') {
            const dashboard = renderWelcomeDashboard(config);
            await interaction.reply({
                components: [dashboard],
                flags: V2 | EPH
            });
        }
        else if (sub === 'test') {
            if (!config.channelId) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Not Configured', 'Please set a welcome channel first using `/welcome setup`.')],
                    flags: V2 | EPH
                });
                return;
            }

            await interaction.deferReply({ flags: EPH });
            const targetChannel = interaction.guild?.channels.cache.get(config.channelId);
            if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Invalid Channel', 'The configured welcome channel could not be found or is not a text channel.')]
                });
                return;
            }

            const payload = buildWelcomePayload(config, interaction.member);
            await targetChannel.send(payload).catch((err) => {
                logger.error('Failed to send test welcome message:', err);
            });

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Test Sent', `Sent a test welcome message directly to <#${config.channelId}>.`)]
            });
        }
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('welcome_wiz:')) return;
        const config = await welcomeSettings.get(interaction.guildId!);
        const action = interaction.customId.split(':')[1];

        if (action === 'toggle_status') {
            const updated = await welcomeSettings.set(interaction.guildId!, { enabled: !config.enabled });
            await interaction.update({ components: [renderWelcomeDashboard(updated)] });
        }
        else if (action === 'toggle_embed') {
            const updated = await welcomeSettings.set(interaction.guildId!, { embedEnabled: !config.embedEnabled });
            await interaction.update({ components: [renderWelcomeDashboard(updated)] });
        }
        else if (action === 'test') {
            await interaction.deferReply({ flags: EPH });
            const targetChannel = interaction.guild?.channels.cache.get(config.channelId!);
            if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Invalid Channel', 'The configured welcome channel could not be found or is not a text channel.')]
                });
                return;
            }

            const payload = buildWelcomePayload(config, interaction.member);
            await targetChannel.send(payload).catch((err) => {
                logger.error('Failed to send test welcome message:', err);
            });

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Test Sent', `Sent a test welcome message to <#${config.channelId}>.`)]
            });
        }
        else if (action === 'modal') {
            const targetModal = interaction.customId.split(':')[2];
            if (targetModal === 'msg') {
                const modal = new ModalBuilder().setCustomId('welcome_wiz_modal:msg').setTitle('Edit Welcome Template');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('template')
                            .setLabel('Message Template Body')
                            .setPlaceholder('Welcome {user} to {guild}! Member #{member_count}')
                            .setValue(config.template)
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );
                await interaction.showModal(modal);
            }
            else if (targetModal === 'embed') {
                const modal = new ModalBuilder().setCustomId('welcome_wiz_modal:embed').setTitle('Edit Welcome Embed Style');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('title')
                            .setLabel('Embed Title text')
                            .setPlaceholder('Welcome to the Server! 🎉')
                            .setValue(config.embedTitle)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('color')
                            .setLabel('Embed HEX Color Code')
                            .setPlaceholder('#8b5cf6')
                            .setValue(config.embedColor)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('image')
                            .setLabel('Banner Image URL (Optional)')
                            .setPlaceholder('https://example.com/banner.png')
                            .setValue(config.embedImage || '')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );
                await interaction.showModal(modal);
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'welcome_wiz:channel') return;
        const channelId = interaction.values[0];
        const updated = await welcomeSettings.set(interaction.guildId!, { channelId });
        await interaction.update({ components: [renderWelcomeDashboard(updated)] });
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith('welcome_wiz_modal:')) return;
        const type = interaction.customId.split(':')[1];

        if (type === 'msg') {
            const template = interaction.fields.getTextInputValue('template').trim();
            const updated = await welcomeSettings.set(interaction.guildId!, { template });
            await (interaction as any).update({ components: [renderWelcomeDashboard(updated)] });
        }
        else if (type === 'embed') {
            const embedTitle = interaction.fields.getTextInputValue('title').trim();
            let embedColor = interaction.fields.getTextInputValue('color').trim();
            if (!embedColor.startsWith('#')) embedColor = `#${embedColor}`;
            const embedImage = interaction.fields.getTextInputValue('image').trim() || null;

            const updated = await welcomeSettings.set(interaction.guildId!, {
                embedTitle,
                embedColor,
                embedImage
            });
            await (interaction as any).update({ components: [renderWelcomeDashboard(updated)] });
        }
    }
};
