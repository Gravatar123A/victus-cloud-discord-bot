import { SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { worldBossService } from '../services/worldBossService.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
function renderHealthBar(current, max, size = 15) {
    const ratio = Math.max(0, Math.min(1, current / max));
    const filled = Math.round(ratio * size);
    const empty = size - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const pct = Math.round(ratio * 100);
    return `\`[${bar}] ${pct}%\``;
}
export const bossCommand = {
    data: new SlashCommandBuilder()
        .setName('boss')
        .setDescription('View the active Cross-Server World Boss raid status, HP, and COINS pool'),
    cooldown: 3,
    async execute(interaction) {
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const state = await worldBossService.getState();
        const boss = state.boss;
        if (!boss) {
            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
            container.addTextDisplayComponents(ComponentsV2.text(state.pending
                ? `Rewards are pending and will retry automatically. The next boss arrives <t:${Math.ceil(state.retryAt / 1000)}:R>.`
                : `The raid is resting. The next boss arrives <t:${Math.ceil(state.retryAt / 1000)}:R>.`));
            await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        const bossName = boss.boss_type === 'ender_dragon' ? '🐉 Ender Dragon' : '💀 The Wither';
        const healthBar = renderHealthBar(boss.current_hp, boss.max_hp);
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
        const topRaiders = Object.entries(boss.participants_json)
            .sort((a, b) => b[1].damage - a[1].damage)
            .slice(0, 5)
            .map(([id, p], i) => `${i + 1}. <@${id}>: \`${p.damage.toLocaleString()} DMG\` (${p.hits} hits)`)
            .join('\n') || '_No damage recorded yet. Be the first to strike!_';
        const text = `# ⚔️ Cross-Server World Boss Raid\n\n` +
            `A terrifying **${bossName}** is threatening the server network!\n\n` +
            `### 🩸 Boss Vitals\n` +
            `› **Health:** ${healthBar} (\`${boss.current_hp.toLocaleString()} / ${boss.max_hp.toLocaleString()} HP\`)\n` +
            `› **Shared Bounty Pool:** **${boss.pool_coins.toLocaleString()} COINS**\n\n` +
            `### 🏅 Top Damage Dealers\n${topRaiders}\n\n` +
            `-# Attack using \`/attack\` or cast powerful spells with \`/cast\`! Linked participants split the bounty. Attacks share a 15-second cooldown; defeated bosses return after 1 hour.`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const attackCommand = {
    data: new SlashCommandBuilder()
        .setName('attack')
        .setDescription('Launch an attack on the Cross-Server World Boss')
        .addStringOption((opt) => opt
        .setName('type')
        .setDescription('Type of attack')
        .setRequired(false)
        .addChoices({ name: '⚔️ Melee Slash (Reliable)', value: 'melee' }, { name: '🏹 Bow Shot (Balanced)', value: 'bow' }, { name: '✨ Magic Blast (High Variance)', value: 'magic' })),
    cooldown: 4,
    async execute(interaction) {
        const type = (interaction.options.getString('type') || 'melee');
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const result = await viralExpansionService.attackWorldBoss(interaction.user, type);
        if (!result.success) {
            const container = ComponentsV2.warningContainer('Raid not ready', result.message);
            await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        const container = ComponentsV2.baseContainer(result.defeated ? ComponentsV2.Accents.success : ComponentsV2.Accents.primary);
        if (result.defeated) {
            const winText = `# 👑 WORLD BOSS SLAIN!\n\n` +
                `<@${interaction.user.id}> delivered the **FINAL FATAL BLOW** with a ${type.toUpperCase()} strike!\n\n` +
                `### 💰 Bounty Distribution (${result.pool.toLocaleString()} COINS Pool Split):\n` +
                `${result.rewardSummary || 'Rewards split among raiders!'}\n\n` +
                `-# Paid rewards are deposited. Pending payouts retry automatically. The next raid opens after 1 hour.`;
            container.addTextDisplayComponents(ComponentsV2.text(winText));
        }
        else {
            const bar = renderHealthBar(result.remainingHp, result.maxHp);
            const hitText = `# 💥 Hit Registered on World Boss!\n\n` +
                `You struck the beast with a **${type.toUpperCase()} strike** dealing **${result.damageDealt} DMG**!\n\n` +
                `› **Remaining HP:** ${bar} (\`${result.remainingHp.toLocaleString()} HP\`)\n` +
                `› **Your Contribution:** Recorded towards the **${result.pool.toLocaleString()} COINS** pool!\n\n` +
                `-# Attack again in 15 seconds. /attack and /cast share the same cooldown.`;
            container.addTextDisplayComponents(ComponentsV2.text(hitText));
        }
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const castCommand = {
    data: new SlashCommandBuilder()
        .setName('cast')
        .setDescription('Cast a magical arcane blast at the Cross-Server World Boss'),
    cooldown: 4,
    async execute(interaction) {
        interaction.options.getString = (name) => name === 'type' ? 'magic' : null;
        return attackCommand.execute(interaction);
    },
};
