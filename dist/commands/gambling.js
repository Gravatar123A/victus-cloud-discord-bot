import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
export const coinflipCommand = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Double-or-nothing coinflip wager with real Victus Cloud COINS')
        .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100000))
        .addStringOption((opt) => opt
        .setName('choice')
        .setDescription('Pick heads or tails (defaults to heads)')
        .setRequired(false)
        .addChoices({ name: '🪙 Heads', value: 'heads' }, { name: '🪙 Tails', value: 'tails' })),
    cooldown: 3,
    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);
        const choice = interaction.options.getString('choice') || 'heads';
        const userId = interaction.user.id;
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const tx = await CoinTransactionLock.executeWagerTransaction(userId, amount, 'gambling_coinflip', `cf:${userId}:${Date.now()}`, `Coinflip wager of ${amount} COINS`, async (user, balance) => {
            const flipResult = Math.random() < 0.5 ? 'heads' : 'tails';
            const won = flipResult === choice;
            const payoutAmount = won ? amount * 2 : 0;
            return {
                won,
                payoutAmount,
                payload: { flipResult, choice },
            };
        });
        if (tx.unlinked) {
            await interaction.editReply({
                content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account. All wagers strictly use your real COINS balance.',
            });
            return;
        }
        if (tx.insufficientBalance || !tx.success) {
            await interaction.editReply({
                content: `❌ ${tx.error || 'Transaction failed.'}`,
            });
            return;
        }
        const { flipResult } = tx.payload;
        const isWin = tx.won;
        const container = ComponentsV2.baseContainer(isWin ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
        const text = `# 🪙 Coinflip: ${isWin ? 'VICTORY!' : 'DEFEAT'}\n\n` +
            `The coin spun through the air and landed on **${flipResult.toUpperCase()}**!\n\n` +
            `› **Your Choice:** ${choice.toUpperCase()}\n` +
            `› **Result:** ${flipResult.toUpperCase()}\n` +
            `› **Wager:** \`${amount} COINS\`\n` +
            `› **Net Outcome:** **${isWin ? `+${amount} COINS 🏆` : `-${amount} COINS 💀`}**\n\n` +
            `### 💳 Updated Balance:\n` +
            `› **${tx.newBalance} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const slotsCommand = {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Spin the 3-reel Minecraft slot machine using real Victus Cloud COINS')
        .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50000)),
    cooldown: 3,
    async execute(interaction) {
        const amount = interaction.options.getInteger('amount', true);
        const userId = interaction.user.id;
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const SYMBOLS = [
            { icon: '🥩', name: 'Steak', mult: 2, weight: 35 },
            { icon: '🪙', name: 'Gold Ingot', mult: 3, weight: 25 },
            { icon: '💎', name: 'Diamond', mult: 5, weight: 15 },
            { icon: '🟩', name: 'Emerald', mult: 10, weight: 8 },
            { icon: '💀', name: 'Wither Skull', mult: 25, weight: 3 },
            { icon: '🧨', name: 'Creeper TNT', mult: 0, weight: 30 },
        ];
        const pickSymbol = () => {
            const totalWeight = SYMBOLS.reduce((s, x) => s + x.weight, 0);
            let rnd = Math.random() * totalWeight;
            for (const sym of SYMBOLS) {
                if (rnd < sym.weight)
                    return sym;
                rnd -= sym.weight;
            }
            return SYMBOLS[0];
        };
        const tx = await CoinTransactionLock.executeWagerTransaction(userId, amount, 'gambling_slots', `slots:${userId}:${Date.now()}`, `Slots spin wager of ${amount} COINS`, async (user) => {
            const reel1 = pickSymbol();
            const reel2 = pickSymbol();
            const reel3 = pickSymbol();
            let won = false;
            let multiplier = 0;
            // 3 of a kind
            if (reel1.icon === reel2.icon && reel2.icon === reel3.icon && reel1.mult > 0) {
                won = true;
                multiplier = reel1.mult;
            }
            // 2 of a kind (consolation)
            else if ((reel1.icon === reel2.icon || reel2.icon === reel3.icon || reel1.icon === reel3.icon) &&
                (reel1.mult > 0 || reel2.mult > 0)) {
                won = true;
                multiplier = 1.2; // Return 1.2x on double match
            }
            const payoutAmount = won ? Math.floor(amount * multiplier) : 0;
            return {
                won,
                payoutAmount,
                payload: { reels: [reel1, reel2, reel3], multiplier },
            };
        });
        if (tx.unlinked) {
            await interaction.editReply({
                content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account. Slots use real COINS.',
            });
            return;
        }
        if (tx.insufficientBalance || !tx.success) {
            await interaction.editReply({ content: `❌ ${tx.error || 'Transaction failed.'}` });
            return;
        }
        const { reels, multiplier } = tx.payload;
        const isWin = tx.won;
        const reelDisplay = `[ ${reels[0].icon} | ${reels[1].icon} | ${reels[2].icon} ]`;
        const container = ComponentsV2.baseContainer(isWin ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
        const text = `# 🎰 Slot Machine: ${isWin ? (multiplier >= 10 ? '🔥 JACKPOT!' : 'WINNER!') : 'NO MATCH'}\n\n` +
            `\`\`\`\n` +
            `┌──────────────┐\n` +
            `│  ${reelDisplay}  │\n` +
            `└──────────────┘\n` +
            `\`\`\`\n` +
            `› **Wagered:** \`${amount} COINS\`\n` +
            `› **Multiplier:** \`${multiplier.toFixed(1)}x\`\n` +
            `› **Payout:** **${tx.payout} COINS**\n\n` +
            `### 💳 Current Balance:\n` +
            `› **${tx.newBalance} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const heistCommand = {
    data: new SlashCommandBuilder()
        .setName('heist')
        .setDescription('Organize a high-stakes group heist on another user’s unbanked COINS')
        .addUserOption((opt) => opt
        .setName('target')
        .setDescription('The user to target for the heist')
        .setRequired(true))
        .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Target loot amount in COINS')
        .setRequired(true)
        .setMinValue(10)
        .setMaxValue(10000)),
    cooldown: 30,
    async execute(interaction) {
        const targetUser = interaction.options.getUser('target', true);
        const amount = interaction.options.getInteger('amount', true);
        const leader = interaction.user;
        if (targetUser.id === leader.id) {
            await interaction.reply({
                content: 'You cannot initiate a heist against yourself!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (targetUser.bot) {
            await interaction.reply({
                content: 'You cannot heist a bot!',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // Verify target has linked account
        const targetLinked = await CoinTransactionLock.resolveLinkedUser(targetUser.id);
        if (!targetLinked) {
            await interaction.reply({
                content: `⚠️ <@${targetUser.id}> has not linked their Victus Cloud account, so they have no unbanked COINS to heist!`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const crew = new Set([leader.id]);
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
        const buildLobbyText = (secondsLeft) => {
            const squadMentions = Array.from(crew).map((id) => `<@${id}>`).join(', ');
            return `# 🚨 HEIST IN PROGRESS: Target: ${targetUser.username}\n\n` +
                `<@${leader.id}> is plotting a raid on <@${targetUser.id}>'s vault for up to **${amount} COINS**!\n\n` +
                `### 👥 Assembled Crew (${crew.size}/5):\n` +
                `› ${squadMentions}\n\n` +
                `› **Current Squad Chance:** \`${crew.size === 1 ? '30%' : crew.size === 2 ? '45%' : crew.size === 3 ? '60%' : '75%'}\`\n` +
                `› **Lobby Expires:** <t:${Math.floor((Date.now() + secondsLeft * 1000) / 1000)}:R>\n\n` +
                `_Click **[Join Heist Crew]** below to join the squad and take a cut of the loot!_`;
        };
        const joinBtn = new ButtonBuilder()
            .setCustomId('victus_heist_join_btn')
            .setLabel('Join Heist Crew')
            .setEmoji('🥷')
            .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(joinBtn);
        container.addTextDisplayComponents(ComponentsV2.text(buildLobbyText(30)));
        const reply = await interaction.reply({
            components: [container, row],
            flags: ComponentsV2.IS_COMPONENTS_V2,
            fetchReply: true,
        });
        // Collect members for 30 seconds
        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30_000,
        });
        collector.on('collect', async (btn) => {
            if (btn.user.id === targetUser.id) {
                await btn.reply({ content: 'You cannot join the heist against yourself!', flags: MessageFlags.Ephemeral });
                return;
            }
            if (crew.has(btn.user.id)) {
                await btn.reply({ content: 'You are already in the heist crew!', flags: MessageFlags.Ephemeral });
                return;
            }
            if (crew.size >= 5) {
                await btn.reply({ content: 'The crew is already full (5/5)!', flags: MessageFlags.Ephemeral });
                return;
            }
            // Check if member is linked
            const linked = await CoinTransactionLock.resolveLinkedUser(btn.user.id);
            if (!linked) {
                await btn.reply({
                    content: 'You must link your Victus Cloud account using `/link` to receive heist loot!',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            crew.add(btn.user.id);
            await btn.deferUpdate();
            const updatedContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
            updatedContainer.addTextDisplayComponents(ComponentsV2.text(buildLobbyText(15)));
            await reply.edit({ components: [updatedContainer, row], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        });
        collector.on('end', async () => {
            // Execute Heist logic
            const squadSize = crew.size;
            const successRate = squadSize === 1 ? 0.30 : squadSize === 2 ? 0.45 : squadSize === 3 ? 0.60 : 0.75;
            const roll = Math.random();
            const heistSuccess = roll < successRate;
            const endContainer = ComponentsV2.baseContainer(heistSuccess ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
            if (!heistSuccess) {
                const failText = `# 🚓 HEIST FAILED: Vault Alarms Triggered!\n\n` +
                    `The security automated defense bots responded to the breach! <@${targetUser.id}>'s vault remained impenetrable!\n\n` +
                    `› **Squad Size:** ${squadSize} raiders\n` +
                    `› **Crew Status:** Busted! All members escaped with zero loot.\n`;
                endContainer.addTextDisplayComponents(ComponentsV2.text(failText));
                await reply.edit({ components: [endContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            // Execute atomic transfer from target to crew
            const heistRes = await CoinTransactionLock.executeTransferOrHeist(targetUser.id, Array.from(crew), amount, 'gambling_heist', `heist:${targetUser.id}:${Date.now()}`, `Vault heist by squad of ${squadSize}`);
            if (!heistRes.success) {
                const errText = `# 🚨 Heist Aborted\n\nTarget vault was empty: ${heistRes.error}`;
                endContainer.addTextDisplayComponents(ComponentsV2.text(errText));
                await reply.edit({ components: [endContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            const payouts = Array.from(heistRes.teamShares.entries())
                .map(([mId, share]) => `› <@${mId}>: **+${share} COINS**`)
                .join('\n');
            const successText = `# 💰 HEIST SUCCESSFUL: Vault Cracked!\n\n` +
                `The squad bypassed the security grid and extracted **${heistRes.actualStolen} COINS** from <@${targetUser.id}>!\n\n` +
                `### 🥷 Loot Distribution:\n${payouts}\n\n` +
                `-# All winnings have been credited to your live Victus Cloud balances!`;
            endContainer.addTextDisplayComponents(ComponentsV2.text(successText));
            await reply.edit({ components: [endContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        });
    },
};
