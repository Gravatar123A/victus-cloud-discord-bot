import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
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
        .setMaxValue(10000)),
    cooldown: 15,
    async execute(interaction) {
        const challenger = interaction.user;
        const opponent = interaction.options.getUser('opponent', true);
        const wager = interaction.options.getInteger('wager', true);
        if (opponent.id === challenger.id || opponent.bot) {
            await interaction.reply({ content: 'Invalid opponent selected.', flags: MessageFlags.Ephemeral });
            return;
        }
        const chalInv = await viralExpansionStore.getInventory(challenger.id);
        const oppInv = await viralExpansionStore.getInventory(opponent.id);
        if (chalInv.mobs_json.length === 0) {
            await interaction.reply({
                content: '⚠️ You do not have any tamed mobs! Tame one first with `/tame`.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (oppInv.mobs_json.length === 0) {
            await interaction.reply({
                content: `⚠️ <@${opponent.id}> does not have any tamed mobs in their zoo yet.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // Verify both have linked accounts and balances
        const chalVictus = await CoinTransactionLock.resolveLinkedUser(challenger.id);
        const oppVictus = await CoinTransactionLock.resolveLinkedUser(opponent.id);
        if (!chalVictus) {
            await interaction.reply({
                content: '⚠️ You must link your Victus Cloud account (`/link`) before wagering real COINS.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!oppVictus) {
            await interaction.reply({
                content: `⚠️ <@${opponent.id}> has not linked their Victus Cloud account yet.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const chalBal = await CoinTransactionLock.getCoinsBalance(chalVictus.email);
        const oppBal = await CoinTransactionLock.getCoinsBalance(oppVictus.email);
        if (chalBal < wager) {
            await interaction.reply({
                content: `⚠️ You only have **${chalBal} COINS**, but attempted to wager **${wager} COINS**.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (oppBal < wager) {
            await interaction.reply({
                content: `⚠️ <@${opponent.id}> only has **${oppBal} COINS**, insufficient for this ${wager} wager.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // Send challenge prompt
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
        const promptText = `# ⚔️ Mob Arena Battle Challenge!\n\n` +
            `<@${challenger.id}> has challenged <@${opponent.id}> to a Mob Duel!\n\n` +
            `› **Pot Size:** **${wager * 2} COINS** (Winner takes all!)\n` +
            `› **Wager Per Player:** \`${wager} COINS\`\n\n` +
            `<@${opponent.id}>, click **[Accept Duel]** within 45 seconds to battle!`;
        container.addTextDisplayComponents(ComponentsV2.text(promptText));
        const acceptBtn = new ButtonBuilder()
            .setCustomId('victus_battle_accept_btn')
            .setLabel('Accept Duel')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Success);
        const declineBtn = new ButtonBuilder()
            .setCustomId('victus_battle_decline_btn')
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(acceptBtn, declineBtn);
        const reply = await interaction.reply({
            components: [container, row],
            flags: ComponentsV2.IS_COMPONENTS_V2,
            fetchReply: true,
        });
        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 45_000,
        });
        collector.on('collect', async (btn) => {
            if (btn.user.id !== opponent.id) {
                await btn.reply({ content: 'Only the challenged player can respond!', flags: MessageFlags.Ephemeral });
                return;
            }
            if (btn.customId === 'victus_battle_decline_btn') {
                collector.stop('declined');
                await btn.deferUpdate();
                const decC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
                decC.addTextDisplayComponents(ComponentsV2.text(`# 🏳️ Challenge Declined\n\n<@${opponent.id}> declined the duel.`));
                await reply.edit({ components: [decC], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            collector.stop('accepted');
            await btn.deferUpdate();
            // Execute duel with atomic wager deductions and payout
            const chalMob = chalInv.mobs_json[0];
            const oppMob = oppInv.mobs_json[0];
            // Atomic wager deduction for challenger
            const chalDeduct = await CoinTransactionLock.executeWagerTransaction(challenger.id, wager, 'battle_wager', `duel:${challenger.id}:${Date.now()}`, `Duel wager vs ${opponent.username}`, async () => ({ won: false, payoutAmount: 0, payload: null }));
            if (!chalDeduct.success) {
                const errC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
                errC.addTextDisplayComponents(ComponentsV2.text(`Duel cancelled: Challenger balance lock failed.`));
                await reply.edit({ components: [errC], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
            // Atomic wager deduction for opponent
            const oppDeduct = await CoinTransactionLock.executeWagerTransaction(opponent.id, wager, 'battle_wager', `duel:${opponent.id}:${Date.now()}`, `Duel wager vs ${challenger.username}`, async () => ({ won: false, payoutAmount: 0, payload: null }));
            if (!oppDeduct.success) {
                // Refund challenger
                await CoinTransactionLock.grantCoins(challenger.id, wager, 'duel_refund', `refund:${challenger.id}`, 'Duel cancelled refund');
                const errC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
                errC.addTextDisplayComponents(ComponentsV2.text(`Duel cancelled: Opponent balance lock failed.`));
                await reply.edit({ components: [errC], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
            // Combat calculation: Power with variance
            const chalScore = chalMob.power * ((Math.random() * 0.4) + 0.8);
            const oppScore = oppMob.power * ((Math.random() * 0.4) + 0.8);
            const challengerWon = chalScore >= oppScore;
            const winner = challengerWon ? challenger : opponent;
            const winnerMob = challengerWon ? chalMob : oppMob;
            const loserMob = challengerWon ? oppMob : chalMob;
            const totalPot = wager * 2;
            await CoinTransactionLock.grantCoins(winner.id, totalPot, 'battle_win', `duel_pot:${winner.id}:${Date.now()}`, `Won duel against ${challengerWon ? opponent.username : challenger.username} (+${totalPot} COINS)`);
            const winContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            const duelResultText = `# 🏆 Duel Finished: <@${winner.id}> Triumphs!\n\n` +
                `**Matchup:**\n` +
                `› <@${challenger.id}>: **${chalMob.name}** (\`${chalMob.power} CP\`)\n` +
                `› <@${opponent.id}>: **${oppMob.name}** (\`${oppMob.power} CP\`)\n\n` +
                `In a fierce clash, **${winnerMob.name}** landed a decisive strike on **${loserMob.name}**!\n\n` +
                `### 💰 Spoils of War:\n` +
                `› **Winner:** <@${winner.id}> claimed the **${totalPot} COINS** pot!\n` +
                `› **Credited:** Direct to Victus Cloud user panel balance!`;
            winContainer.addTextDisplayComponents(ComponentsV2.text(duelResultText));
            await reply.edit({ components: [winContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        });
        collector.on('end', async (_, reason) => {
            if (reason === 'time') {
                const timeoutC = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
                timeoutC.addTextDisplayComponents(ComponentsV2.text('# ⏳ Challenge Expired\n\nThe duel challenge timed out with no response.'));
                await reply.edit({ components: [timeoutC], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
            }
        });
    },
};
