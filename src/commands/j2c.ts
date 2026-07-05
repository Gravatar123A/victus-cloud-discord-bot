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
import { j2cSettings, J2CConfig } from '../services/j2cSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function renderJ2CDashboard(config: J2CConfig): any {
    const c = ComponentsV2.baseContainer(config.enabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);
    
    const text = `# 🔊 Join to Create VC Setup\n` +
        `Configure the dynamic voice channel manager.\n\n` +
        `› **Status:** ${config.enabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `› **Hub Voice Channel:** ${config.channelId ? `<#${config.channelId}>` : '*Not configured (Required)*'}\n` +
        `› **Parent Category:** ${config.categoryId ? `<#${config.categoryId}>` : '*Hub category (Default)*'}\n` +
        `› **Channel Name Format:** \`${config.nameFormat}\`\n\n` +
        `Use the controls below to configure settings.`;
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Select Hub Channel (Voice)
    const hubSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('j2c_wiz:hub_channel')
            .setPlaceholder('Select hub voice channel (trigger)...')
            .addChannelTypes(ChannelType.GuildVoice)
    );
    
    // Row 2: Select Parent Category
    const categorySelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('j2c_wiz:category')
            .setPlaceholder('Select parent category (optional)...')
            .addChannelTypes(ChannelType.GuildCategory)
    );
    
    // Row 3: Buttons
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('j2c_wiz:toggle_status')
            .setLabel(config.enabled ? 'Disable J2C 🔴' : 'Enable J2C 🟢')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('j2c_wiz:modal:name')
            .setLabel('Edit Name Format')
            .setStyle(ButtonStyle.Secondary)
    );
    
    c.addActionRowComponents(hubSelect);
    c.addActionRowComponents(categorySelect);
    c.addActionRowComponents(btnRow);
    
    return c;
}

export function buildVoiceControlPanel(ownerId: string): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    
    const text = `# 🎙️ Voice Channel Control Panel\n` +
        `Configure your temporary voice channel using the interactive buttons below.\n\n` +
        `› **Channel Owner:** <@${ownerId}>\n\n` +
        `### Controls\n` +
        `🔒 **Lock:** Prevent anyone else from connecting\n` +
        `🔓 **Unlock:** Allow anyone to connect\n` +
        `✏️ **Rename:** Edit the name of this voice channel\n` +
        `🔢 **Limit:** Set user capacity limit (0-99)\n` +
        `🚷 **Kick:** Remove a specific user from your VC\n` +
        `👑 **Claim:** If the owner has left, click to claim the channel`;
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('j2c_panel:lock').setLabel('Lock 🔒').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('j2c_panel:unlock').setLabel('Unlock 🔓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_panel:modal:rename').setLabel('Rename ✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('j2c_panel:modal:limit').setLabel('Limit 🔢').setStyle(ButtonStyle.Secondary)
    );
    
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('j2c_panel:modal:kick').setLabel('Kick User 🚷').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('j2c_panel:claim').setLabel('Claim Ownership 👑').setStyle(ButtonStyle.Success)
    );
    
    c.addActionRowComponents(row1);
    c.addActionRowComponents(row2);
    
    return c;
}

export const j2cCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('j2c')
        .setDescription('Configure the Join to Create voice system')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Open the Join to Create voice system setup wizard')
        ),

    async execute(interaction) {
        const config = await j2cSettings.get(interaction.guildId!);
        const dashboard = renderJ2CDashboard(config);
        await interaction.reply({
            components: [dashboard],
            flags: V2 | EPH
        });
    },

    async handleButton(interaction) {
        // Wizard dashboard buttons
        if (interaction.customId.startsWith('j2c_wiz:')) {
            const config = await j2cSettings.get(interaction.guildId!);
            const action = interaction.customId.split(':')[1];

            if (action === 'toggle_status') {
                const updated = await j2cSettings.set(interaction.guildId!, { enabled: !config.enabled });
                await interaction.update({ components: [renderJ2CDashboard(updated)] });
            }
            else if (action === 'modal') {
                const target = interaction.customId.split(':')[2];
                if (target === 'name') {
                    const modal = new ModalBuilder().setCustomId('j2c_wiz_modal:name').setTitle('Edit Channel Name Format');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('format')
                                .setLabel('Name Format (Supports {username})')
                                .setPlaceholder('🔊 {username}\'s Lounge')
                                .setValue(config.nameFormat)
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
            }
            return;
        }

        // Voice text chat control panel buttons
        if (interaction.customId.startsWith('j2c_panel:')) {
            const action = interaction.customId.split(':')[1];
            
            const tempChannels = await j2cSettings.getTempChannelsInfo();
            const tempChannel = tempChannels.find(i => i.channelId === interaction.channelId);
            
            if (!tempChannel) {
                await interaction.reply({ content: '❌ This channel is not a registered temporary voice channel.', flags: EPH });
                return;
            }

            if (action === 'claim') {
                const voiceChannel = interaction.channel as any;
                const ownerStillInVC = voiceChannel.members.has(tempChannel.ownerId);
                
                if (ownerStillInVC) {
                    await interaction.reply({ content: `❌ You cannot claim this channel because the current owner (<@${tempChannel.ownerId}>) is still in the voice channel.`, flags: EPH });
                    return;
                }
                
                await j2cSettings.setTempChannelOwner(voiceChannel.id, interaction.user.id);
                const updatedPanel = buildVoiceControlPanel(interaction.user.id);
                await interaction.update({ components: [updatedPanel] });
                await voiceChannel.send({ content: `👑 <@${interaction.user.id}> has claimed ownership of this voice channel!` }).catch(() => {});
                return;
            }

            if (tempChannel.ownerId !== interaction.user.id) {
                await interaction.reply({ content: `❌ Only the channel owner (<@${tempChannel.ownerId}>) can use this button.`, flags: EPH });
                return;
            }

            if (action === 'lock') {
                await (interaction.channel as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: false }).catch(() => {});
                await interaction.reply({ content: '🔒 Your voice channel has been locked. Only allowed members can join now.', flags: EPH });
            }
            else if (action === 'unlock') {
                await (interaction.channel as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: null }).catch(() => {});
                await interaction.reply({ content: '🔓 Your voice channel has been unlocked. Anyone can join now.', flags: EPH });
            }
            else if (action === 'modal') {
                const target = interaction.customId.split(':')[2];
                if (target === 'rename') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:rename').setTitle('Rename Voice Channel');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('name')
                                .setLabel('New Channel Name')
                                .setPlaceholder('🔊 Study Room')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'limit') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:limit').setTitle('Set User Limit');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('limit')
                                .setLabel('User Limit (0-99)')
                                .setPlaceholder('0 for unlimited')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'kick') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:kick').setTitle('Kick User from VC');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setPlaceholder('84729384729837482')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('j2c_wiz:')) return;
        const action = interaction.customId.split(':')[1];
        const val = interaction.values[0];

        if (action === 'hub_channel') {
            const updated = await j2cSettings.set(interaction.guildId!, { channelId: val });
            await interaction.update({ components: [renderJ2CDashboard(updated)] });
        }
        else if (action === 'category') {
            const updated = await j2cSettings.set(interaction.guildId!, { categoryId: val });
            await interaction.update({ components: [renderJ2CDashboard(updated)] });
        }
    },

    async handleModal(interaction) {
        // Wizard settings modal
        if (interaction.customId === 'j2c_wiz_modal:name') {
            const format = interaction.fields.getTextInputValue('format').trim();
            const updated = await j2cSettings.set(interaction.guildId!, { nameFormat: format });
            await (interaction as any).update({ components: [renderJ2CDashboard(updated)] });
            return;
        }

        // Voice control panel modals
        if (interaction.customId.startsWith('j2c_panel_modal:')) {
            const action = interaction.customId.split(':')[1];
            const tempChannels = await j2cSettings.getTempChannelsInfo();
            const tempChannel = tempChannels.find(i => i.channelId === interaction.channelId);

            if (!tempChannel || tempChannel.ownerId !== interaction.user.id) {
                await interaction.reply({ content: '❌ You are not the owner of this channel.', flags: EPH });
                return;
            }

            if (action === 'rename') {
                const newName = interaction.fields.getTextInputValue('name').trim();
                await (interaction.channel as any).setName(newName).catch(() => {});
                await interaction.reply({ content: `✏️ Voice channel renamed to **${newName}**.`, flags: EPH });
            }
            else if (action === 'limit') {
                const limitStr = interaction.fields.getTextInputValue('limit').trim();
                const limit = parseInt(limitStr, 10);
                if (isNaN(limit) || limit < 0 || limit > 99) {
                    await interaction.reply({ content: '❌ Please enter a valid number between 0 and 99.', flags: EPH });
                    return;
                }
                await (interaction.channel as any).setUserLimit(limit).catch(() => {});
                await interaction.reply({ content: `🔢 User limit set to **${limit === 0 ? 'Unlimited' : limit}**.`, flags: EPH });
            }
            else if (action === 'kick') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const voiceChannel = interaction.channel as any;
                
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in this voice channel.', flags: EPH });
                    return;
                }

                if (targetMember.id === interaction.user.id) {
                    await interaction.reply({ content: '❌ You cannot kick yourself!', flags: EPH });
                    return;
                }

                await targetMember.voice.disconnect().catch(() => {});
                await interaction.reply({ content: `🚷 Kicked <@${targetMember.id}> from this voice channel.`, flags: EPH });
            }
        }
    }
};
