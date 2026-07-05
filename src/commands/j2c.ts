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
        if (interaction.customId === 'j2c_wiz_modal:name') {
            const format = interaction.fields.getTextInputValue('format').trim();
            const updated = await j2cSettings.set(interaction.guildId!, { nameFormat: format });
            await (interaction as any).update({ components: [renderJ2CDashboard(updated)] });
        }
    }
};
