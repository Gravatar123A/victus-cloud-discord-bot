import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
export const hostPromoCommand = {
    data: new SlashCommandBuilder()
        .setName('host')
        .setDescription('Get instant free 24/7 Minecraft & VPS server hosting on Victus Cloud'),
    cooldown: 5,
    async execute(interaction) {
        let referralLink = `${config.branding.website}/free`;
        let ownerMention = '';
        if (interaction.guild) {
            const botGuild = await viralExpansionStore.getGuild(interaction.guild.id, interaction.guild.ownerId);
            ownerMention = `<@${interaction.guild.ownerId}>`;
            // Try to find the guild owner's personal referral code
            const linked = await supabase.getLinkedAccount(interaction.guild.ownerId).catch(() => null);
            if (linked?.user_id) {
                const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                if (profile?.referral_code) {
                    referralLink = `${config.branding.website}/ref/${profile.referral_code}`;
                }
            }
            else if (botGuild.ref_code) {
                referralLink = `${config.branding.website}/ref/${botGuild.ref_code}`;
            }
        }
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        const text = `# ⚡ Deploy Your Free 24/7 Server on Victus Cloud\n\n` +
            `Need a 24/7 Minecraft SMP, Discord bot host, or lightning-fast VPS with zero lag?\n\n` +
            `### 🚀 What You Get for Free:\n` +
            `› **Instant Setup:** 10-second deployment with no wait queues\n` +
            `› **AMD Ryzen 9 & DDR5:** Unmetered NVMe SSD storage and DDoS shield\n` +
            `› **Full SFTP & Console:** 1-Click modpack, plugin, and Paper/Purpur installer\n` +
            `› **Real Victus COINS:** Earn coins through Discord chat & mini-games to upgrade specs for free!\n\n` +
            `🎁 **Community Special:** Server supported by ${ownerMention || 'our Discord community'}! Sign up below to claim bonus starter credits:`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('Claim Free Server')
            .setURL(referralLink)
            .setStyle(ButtonStyle.Link)
            .setEmoji('🚀'), new ButtonBuilder()
            .setLabel('View Documentation & Bot Guide')
            .setURL(`${config.branding.website}/bot`)
            .setStyle(ButtonStyle.Link)
            .setEmoji('📖'));
        await interaction.reply({
            components: [container, btnRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
export const freeServerCommand = {
    ...hostPromoCommand,
    data: new SlashCommandBuilder()
        .setName('free-server')
        .setDescription('Get instant free 24/7 Minecraft & VPS server hosting on Victus Cloud'),
};
