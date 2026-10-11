import { createPvpChallenge } from './pvp.js';
import { SlashCommandBuilder, MessageFlags, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
export const tameCommand = {
    data: new SlashCommandBuilder()
        .setName('tame')
        .setDescription('Tame a wild Minecraft mob that has appeared in the chat'),
    cooldown: 2,
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'You can only tame mobs inside a Discord server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const res = await viralExpansionService.tameWildMob(interaction.guild.id, interaction.user);
        if (res.success) {
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            c.addTextDisplayComponents(ComponentsV2.text(res.message));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
        else {
            await interaction.reply({ content: `❌ ${res.message}`, flags: MessageFlags.Ephemeral });
        }
    },
};
export const zooCommand = {
    data: new SlashCommandBuilder()
        .setName('zoo')
        .setDescription('View your collection of tamed Minecraft mobs, rarity stars, and battle power'),
    cooldown: 3,
    async execute(interaction) {
        const inv = await viralExpansionStore.getInventory(interaction.user.id);
        const mobs = inv.mobs_json;
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
        if (mobs.length === 0) {
            const emptyText = `# 🐾 Your Mob Zoo is Empty!\n\n` +
                `You haven't tamed any wild mobs yet!\n\n` +
                `Keep chatting in server channels. When a wild mob spawns, be the first to type \`/tame\` to capture it!`;
            container.addTextDisplayComponents(ComponentsV2.text(emptyText));
            await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        const rarityIcons = {
            mythic: '🌌',
            legendary: '👑',
            epic: '🟣',
            rare: '🔵',
            common: '⚪',
        };
        const mobEntries = mobs.map((m, idx) => {
            const stars = '⭐'.repeat(m.stars || 1);
            const icon = rarityIcons[m.rarity] || '🐾';
            return `**${idx + 1}. ${icon} ${m.name}** [${m.rarity.toUpperCase()}]\n` +
                `› Stars: ${stars} | CP: \`${m.power} CP\` | HP: \`${m.health || m.power * 2} HP\``;
        }).join('\n\n');
        const text = `# 🐾 Mob Sanctuary & Zoo: ${interaction.user.username}\n\n` +
            `You currently manage **${mobs.length} tamed creatures**!\n\n` +
            `### 📜 Captured Roster:\n${mobEntries}\n\n` +
            `-# Challenge other trainers to high-stakes duels with \`/battle @user <wager>\`!`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const battleCommand = {
    data: new SlashCommandBuilder()
        .setName('battle')
        .setDescription('Challenge another user to a turn-based mob battle with a COINS wager')
        .addUserOption((opt) => opt
        .setName('opponent')
        .setDescription('User to challenge')
        .setRequired(true))
        .addIntegerOption((opt) => opt
        .setName('wager')
        .setDescription('Amount of COINS to wager (each player wagers this amount)')
        .setRequired(true)
        .setMinValue(5)
        .setMaxValue(5000)),
    async execute(interaction) {
        return createPvpChallenge(interaction, 'battle', 'wager');
    },
};
