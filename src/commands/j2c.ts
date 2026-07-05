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
    StringSelectMenuBuilder,
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
        `Use the dropdown menu below to manage your temporary voice channel. Only the channel owner (<@${ownerId}>) can change settings, but others can claim ownership if the owner leaves.\n\n` +
        `› **Current Owner:** <@${ownerId}>\n\n` +
        `### Controls List\n` +
        `› **Privacy:** Lock, Unlock, Hide, Reveal, Trust/Permit, Remove Trust\n` +
        `› **Configuration:** Rename, Limit, Reset Permissions, Info\n` +
        `› **Moderation:** Kick, Ban, Unban, Mute, Unmute, Deafen, Undeafen\n` +
        `› **Management:** Transfer Ownership, Claim Ownership`;
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const options = [
        { label: '🔒 Lock Channel', value: 'lock', description: 'Prevent anyone else from joining' },
        { label: '🔓 Unlock Channel', value: 'unlock', description: 'Allow anyone to join' },
        { label: '👁️ Hide Channel', value: 'hide', description: 'Hide the channel from the channel list' },
        { label: '🔎 Reveal Channel', value: 'reveal', description: 'Make the channel visible to everyone' },
        { label: '✏️ Rename Channel', value: 'modal_rename', description: 'Change the voice channel name' },
        { label: '🔢 Change Capacity Limit', value: 'modal_limit', description: 'Set user limit (0-99)' },
        { label: '🚷 Kick User', value: 'modal_kick', description: 'Disconnect a user from the channel' },
        { label: '🚫 Ban User', value: 'modal_ban', description: 'Ban a user from connecting to the channel' },
        { label: '✅ Unban User', value: 'modal_unban', description: 'Remove a ban override' },
        { label: '🔇 Mute User', value: 'modal_mute', description: 'Server-mute a user in your VC' },
        { label: '🔊 Unmute User', value: 'modal_unmute', description: 'Server-unmute a user in your VC' },
        { label: '🔇 Deafen User', value: 'modal_deafen', description: 'Server-deafen a user in your VC' },
        { label: '🔊 Undeafen User', value: 'modal_undeafen', description: 'Server-undeafen a user in your VC' },
        { label: '🟢 Trust/Permit User', value: 'modal_permit', description: 'Allow a user to join locked channel' },
        { label: '🔴 Remove Trust Override', value: 'modal_unpermit', description: 'Remove trust permission override' },
        { label: '🔄 Reset Permissions', value: 'reset', description: 'Reset all channel overrides' },
        { label: '👑 Transfer Ownership', value: 'modal_transfer', description: 'Transfer owner role to another member' },
        { label: '👑 Claim Ownership', value: 'claim', description: 'Claim ownership if owner is not in VC' },
        { label: 'ℹ️ Channel Information', value: 'info', description: 'Show current channel statistics' }
    ];

    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('j2c_panel:select_action')
            .setPlaceholder('Select a voice control action...')
            .addOptions(options)
    );
    
    c.addActionRowComponents(selectMenu);
    
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
        if (!interaction.customId.startsWith('j2c_wiz:')) return;
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
    },

    async handleSelectMenu(interaction) {
        // Setup wizard selectors
        if (interaction.customId.startsWith('j2c_wiz:')) {
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
            return;
        }

        // Voice chat control panel selector
        if (interaction.customId === 'j2c_panel:select_action') {
            const action = interaction.values[0];
            const tempChannels = await j2cSettings.getTempChannelsInfo();
            const tempChannel = tempChannels.find(i => i.channelId === interaction.channelId);
            
            if (!tempChannel) {
                await interaction.reply({ content: '❌ This channel is not a registered temporary voice channel.', flags: EPH });
                return;
            }

            // Claim action does not require ownership
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

            // Other actions require ownership
            if (tempChannel.ownerId !== interaction.user.id) {
                await interaction.reply({ content: `❌ Only the channel owner (<@${tempChannel.ownerId}>) can use this panel.`, flags: EPH });
                return;
            }

            const voiceChannel = interaction.channel as any;

            if (action === 'lock') {
                await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: false }).catch(() => {});
                await interaction.reply({ content: '🔒 Your voice channel has been locked. Only allowed members can join now.', flags: EPH });
            }
            else if (action === 'unlock') {
                await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: null }).catch(() => {});
                await interaction.reply({ content: '🔓 Your voice channel has been unlocked. Anyone can join now.', flags: EPH });
            }
            else if (action === 'hide') {
                await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { ViewChannel: false }).catch(() => {});
                await interaction.reply({ content: '👁️ Your voice channel has been hidden from the channel list.', flags: EPH });
            }
            else if (action === 'reveal') {
                await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { ViewChannel: null }).catch(() => {});
                await interaction.reply({ content: '🔎 Your voice channel is now visible to everyone.', flags: EPH });
            }
            else if (action === 'reset') {
                await voiceChannel.permissionOverwrites.set([
                    {
                        id: tempChannel.ownerId,
                        allow: ['ManageChannels', 'MoveMembers', 'MuteMembers', 'DeafenMembers']
                    }
                ]).catch(() => {});
                await interaction.reply({ content: '🔄 Reset all voice channel permission overrides.', flags: EPH });
            }
            else if (action === 'info') {
                const locked = voiceChannel.permissionOverwrites.cache.get(interaction.guild!.roles.everyone.id)?.deny.has('Connect');
                const hidden = voiceChannel.permissionOverwrites.cache.get(interaction.guild!.roles.everyone.id)?.deny.has('ViewChannel');
                
                const stats = `# ℹ️ Voice Channel Information\n` +
                    `› **Owner:** <@${tempChannel.ownerId}>\n` +
                    `› **User Limit:** \`${voiceChannel.userLimit || 'Unlimited'}\`\n` +
                    `› **Connected Members:** \`${voiceChannel.members.size}\`\n` +
                    `› **Locked Status:** \`${locked ? 'Locked 🔒' : 'Unlocked 🔓'}\`\n` +
                    `› **Visibility:** \`${hidden ? 'Hidden 👁️' : 'Visible 🔎'}\``;
                    
                await interaction.reply({ content: stats, flags: EPH });
            }
            else if (action.startsWith('modal_')) {
                const target = action.split('_')[1];
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
                else if (target === 'ban') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:ban').setTitle('Ban User from VC');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'unban') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:unban').setTitle('Unban User from VC');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'mute') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:mute').setTitle('Server-Mute User');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'unmute') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:unmute').setTitle('Server-Unmute User');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'deafen') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:deafen').setTitle('Server-Deafen User');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'undeafen') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:undeafen').setTitle('Server-Undeafen User');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'permit') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:permit').setTitle('Trust/Permit User');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'unpermit') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:unpermit').setTitle('Remove Trust Override');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'transfer') {
                    const modal = new ModalBuilder().setCustomId('j2c_panel_modal:transfer').setTitle('Transfer VC Ownership');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('userId')
                                .setLabel('New Owner User ID or Username')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
            }
        }
    },

    async handleModal(interaction) {
        // Setup wizard modals
        if (interaction.customId === 'j2c_wiz_modal:name') {
            const format = interaction.fields.getTextInputValue('format').trim();
            const updated = await j2cSettings.set(interaction.guildId!, { nameFormat: format });
            await (interaction as any).update({ components: [renderJ2CDashboard(updated)] });
            return;
        }

        // Voice panel modals
        if (interaction.customId.startsWith('j2c_panel_modal:')) {
            const action = interaction.customId.split(':')[1];
            const tempChannels = await j2cSettings.getTempChannelsInfo();
            const tempChannel = tempChannels.find(i => i.channelId === interaction.channelId);

            if (!tempChannel || tempChannel.ownerId !== interaction.user.id) {
                await interaction.reply({ content: '❌ You are not the owner of this channel.', flags: EPH });
                return;
            }

            const voiceChannel = interaction.channel as any;

            if (action === 'rename') {
                const newName = interaction.fields.getTextInputValue('name').trim();
                await voiceChannel.setName(newName).catch(() => {});
                await interaction.reply({ content: `✏️ Voice channel renamed to **${newName}**.`, flags: EPH });
            }
            else if (action === 'limit') {
                const limitStr = interaction.fields.getTextInputValue('limit').trim();
                const limit = parseInt(limitStr, 10);
                if (isNaN(limit) || limit < 0 || limit > 99) {
                    await interaction.reply({ content: '❌ Please enter a number between 0 and 99.', flags: EPH });
                    return;
                }
                await voiceChannel.setUserLimit(limit).catch(() => {});
                await interaction.reply({ content: `🔢 User limit set to **${limit === 0 ? 'Unlimited' : limit}**.`, flags: EPH });
            }
            else if (action === 'kick') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
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
            else if (action === 'ban') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = interaction.guild?.members.cache.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in the server.', flags: EPH });
                    return;
                }
                if (targetMember.id === interaction.user.id) {
                    await interaction.reply({ content: '❌ You cannot ban yourself!', flags: EPH });
                    return;
                }
                await voiceChannel.permissionOverwrites.edit(targetMember.id, { Connect: false }).catch(() => {});
                if (voiceChannel.members.has(targetMember.id)) {
                    await targetMember.voice.disconnect().catch(() => {});
                }
                await interaction.reply({ content: `🚫 Banned <@${targetMember.id}> from connecting to this voice channel.`, flags: EPH });
            }
            else if (action === 'unban') {
                const userId = interaction.fields.getTextInputValue('userId').trim();
                await voiceChannel.permissionOverwrites.delete(userId).catch(() => {});
                await interaction.reply({ content: `✅ Unbanned user ID \`${userId}\` from this voice channel.`, flags: EPH });
            }
            else if (action === 'mute') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in this voice channel.', flags: EPH });
                    return;
                }
                await targetMember.voice.setMute(true).catch(() => {});
                await interaction.reply({ content: `🔇 Server-muted <@${targetMember.id}> in this VC.`, flags: EPH });
            }
            else if (action === 'unmute') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in this voice channel.', flags: EPH });
                    return;
                }
                await targetMember.voice.setMute(false).catch(() => {});
                await interaction.reply({ content: `🔊 Server-unmuted <@${targetMember.id}> in this VC.`, flags: EPH });
            }
            else if (action === 'deafen') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in this voice channel.', flags: EPH });
                    return;
                }
                await targetMember.voice.setDeaf(true).catch(() => {});
                await interaction.reply({ content: `🔇 Server-deafened <@${targetMember.id}> in this VC.`, flags: EPH });
            }
            else if (action === 'undeafen') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in this voice channel.', flags: EPH });
                    return;
                }
                await targetMember.voice.setDeaf(false).catch(() => {});
                await interaction.reply({ content: `🔊 Server-undeafened <@${targetMember.id}> in this VC.`, flags: EPH });
            }
            else if (action === 'permit') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = interaction.guild?.members.cache.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in the server.', flags: EPH });
                    return;
                }
                await voiceChannel.permissionOverwrites.edit(targetMember.id, { Connect: true }).catch(() => {});
                await interaction.reply({ content: `🟢 Trusted/Permitted <@${targetMember.id}> to join this voice channel.`, flags: EPH });
            }
            else if (action === 'unpermit') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = interaction.guild?.members.cache.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ Could not find that member in the server.', flags: EPH });
                    return;
                }
                await voiceChannel.permissionOverwrites.delete(targetMember.id).catch(() => {});
                await interaction.reply({ content: `🔴 Removed trust permission override for <@${targetMember.id}>.`, flags: EPH });
            }
            else if (action === 'transfer') {
                const input = interaction.fields.getTextInputValue('userId').trim().toLowerCase();
                const targetMember = voiceChannel.members.find((m: any) => 
                    m.id === input || m.user.username.toLowerCase() === input || m.user.tag.toLowerCase() === input
                );

                if (!targetMember) {
                    await interaction.reply({ content: '❌ The new owner must be currently connected to this voice channel.', flags: EPH });
                    return;
                }

                await j2cSettings.setTempChannelOwner(voiceChannel.id, targetMember.id);
                const updatedPanel = buildVoiceControlPanel(targetMember.id);
                await (interaction.message as any).edit({ components: [updatedPanel] });
                await voiceChannel.send({ content: `👑 Control Panel ownership has been transferred to <@${targetMember.id}>!` }).catch(() => {});
                await interaction.reply({ content: `👑 Transferred ownership of this voice channel to <@${targetMember.id}>.`, flags: EPH });
            }
        }
    }
};
