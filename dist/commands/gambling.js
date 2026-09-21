import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
export const coinflipCommand = {
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Double-or-nothing coinflip wager with real Victus Cloud COINS (OwO style: !cf <bet> [h/t])')
        .addStringOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager (or "all", "half")')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('choice')
        .setDescription('Pick heads or tails (defaults to heads)')
        .setRequired(false)
        .addChoices({ name: '🪙 Heads (h)', value: 'heads' }, { name: '🪙 Tails (t)', value: 'tails' })),
    cooldown: 3,
    async execute(interaction) {
        let rawAmountStr = interaction.options.getString?.('amount') ?? interaction.options.getInteger?.('amount') ?? null;
        let choice = interaction.options.getString?.('choice') ?? null;
        const userId = interaction.user.id;
        // Support OwO prefix arguments: !cf 50 h, !cf h 50, !cf all, !cf half t
        const rawMessage = interaction.message;
        if (rawMessage?.content) {
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            for (const part of parts) {
                const lower = part.toLowerCase();
                if (['h', 'head', 'heads', '🪙'].includes(lower)) {
                    choice = 'heads';
                }
                else if (['t', 'tail', 'tails'].includes(lower)) {
                    choice = 'tails';
                }
                else if (['all', 'max', 'half'].includes(lower) || /^\d+$/.test(lower)) {
                    rawAmountStr = lower;
                }
            }
        }
        if (!choice)
            choice = 'heads';
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const user = await CoinTransactionLock.resolveLinkedUser(userId);
        if (!user) {
            await interaction.editReply({
                content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account. All wagers strictly use your real COINS balance.',
            });
            return;
        }
        const balance = await CoinTransactionLock.getCoinsBalance(user.email);
        const amount = CoinTransactionLock.resolveWagerAmount(rawAmountStr, balance, 100000);
        if (!amount || amount <= 0) {
            await interaction.editReply({
                content: `❌ Please specify a valid wager amount! Examples: \`/coinflip amount:50 choice:heads\`, \`!cf 50 h\`, \`!cf all\`, \`!cf half t\`.`,
            });
            return;
        }
        const tx = await CoinTransactionLock.executeWagerTransaction(userId, amount, 'gambling_coinflip', `cf:${userId}:${Date.now()}`, `Coinflip wager of ${amount} COINS on ${choice}`, async () => {
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
            `The coin spun through the air and landed on **${flipResult.toUpperCase()}** 🪙!\n\n` +
            `› **Your Choice:** \`${choice.toUpperCase()}\`\n` +
            `› **Result:** \`${flipResult.toUpperCase()}\`\n` +
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
async function executeRpsDuel(interaction, challenger, opponent, rawAmountStr) {
    if (challenger.id === opponent.id) {
        await interaction.reply({
            content: '❌ You cannot challenge yourself to a duel!',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (opponent.bot) {
        await interaction.reply({
            content: '❌ You cannot challenge a bot to a duel! If you want to play against the bot, omit the opponent parameter.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const chalUser = await CoinTransactionLock.resolveLinkedUser(challenger.id);
    if (!chalUser) {
        await interaction.reply({
            content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account before dueling with COINS.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const oppUser = await CoinTransactionLock.resolveLinkedUser(opponent.id);
    if (!oppUser) {
        await interaction.reply({
            content: `⚠️ <@${opponent.id}> has not linked their Victus Cloud account yet! They must run \`/link\` first.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const chalBal = await CoinTransactionLock.getCoinsBalance(chalUser.email);
    const oppBal = await CoinTransactionLock.getCoinsBalance(oppUser.email);
    const wager = CoinTransactionLock.resolveWagerAmount(rawAmountStr, chalBal, 100000);
    if (!wager || wager <= 0) {
        await interaction.reply({
            content: `❌ Please specify a valid wager amount! (e.g. \`/rps-duel opponent:@user amount:50\` or \`!rps @user 50\`)`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (chalBal < wager) {
        await interaction.reply({
            content: `⚠️ You only have **${chalBal} COINS**, which is not enough for a **${wager} COINS** wager!`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (oppBal < wager) {
        await interaction.reply({
            content: `⚠️ <@${opponent.id}> only has **${oppBal} COINS**, which is not enough for a **${wager} COINS** wager!`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const duelId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const totalPot = wager * 2;
    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
    const promptText = `# ⚔️ Rock Paper Scissors: 1v1 Duel Challenge!\n\n` +
        `<@${challenger.id}> has challenged <@${opponent.id}> to a high-stakes **Rock Paper Scissors Duel**!\n\n` +
        `› 💰 **Wager Per Player:** \`${wager} COINS\`\n` +
        `› 🏆 **Winner's Pot:** **${totalPot} COINS** (Winner takes all!)\n\n` +
        `<@${opponent.id}>, click **[Accept Duel]** within 45 seconds to battle!`;
    container.addTextDisplayComponents(ComponentsV2.text(promptText));
    const acceptBtn = new ButtonBuilder()
        .setCustomId(`rps_accept_${duelId}`)
        .setLabel('Accept Duel')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Success);
    const declineBtn = new ButtonBuilder()
        .setCustomId(`rps_decline_${duelId}`)
        .setLabel('Decline')
        .setEmoji('🏳️')
        .setStyle(ButtonStyle.Danger);
    const challengeRow = new ActionRowBuilder().addComponents(acceptBtn, declineBtn);
    const reply = await interaction.reply({
        components: [container, challengeRow],
        flags: ComponentsV2.IS_COMPONENTS_V2,
        fetchReply: true,
    });
    const targetMsg = reply || (interaction.fetchReply ? await interaction.fetchReply().catch(() => null) : null);
    if (!targetMsg)
        return;
    const inviteCollector = targetMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 45_000,
    });
    inviteCollector.on('collect', async (btn) => {
        if (btn.user.id !== opponent.id) {
            await btn.reply({
                content: `⛔ Only <@${opponent.id}> can accept or decline this duel challenge!`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (btn.customId === `rps_decline_${duelId}`) {
            inviteCollector.stop('declined');
            await btn.deferUpdate().catch(() => { });
            const decC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            decC.addTextDisplayComponents(ComponentsV2.text(`# 🏳️ Challenge Declined\n\n<@${opponent.id}> declined the Rock Paper Scissors duel.`));
            await targetMsg.edit({ components: [decC], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
            return;
        }
        inviteCollector.stop('accepted');
        await btn.deferUpdate().catch(() => { });
        // Step 2: Atomic balance deductions for escrow
        const chalDeduct = await CoinTransactionLock.executeWagerTransaction(challenger.id, wager, 'rps_duel_wager', `rps_duel:${challenger.id}:${Date.now()}`, `RPS duel wager vs ${opponent.username}`, async () => ({ won: false, payoutAmount: 0, payload: null }));
        if (!chalDeduct.success) {
            const errC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            errC.addTextDisplayComponents(ComponentsV2.text(`❌ Duel cancelled: Challenger balance lock failed.`));
            await targetMsg.edit({ components: [errC], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        const oppDeduct = await CoinTransactionLock.executeWagerTransaction(opponent.id, wager, 'rps_duel_wager', `rps_duel:${opponent.id}:${Date.now()}`, `RPS duel wager vs ${challenger.username}`, async () => ({ won: false, payoutAmount: 0, payload: null }));
        if (!oppDeduct.success) {
            await CoinTransactionLock.grantCoins(challenger.id, wager, 'rps_duel_refund', `refund:${challenger.id}:${Date.now()}`, 'RPS duel cancelled refund');
            const errC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            errC.addTextDisplayComponents(ComponentsV2.text(`❌ Duel cancelled: Opponent balance lock failed.`));
            await targetMsg.edit({ components: [errC], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        // Step 3: Secret Move Selection Phase
        const choices = {};
        function renderMoveContainer() {
            const chalStatus = choices[challenger.id] ? '✅ **Choice Locked in!**' : '⏳ *Choosing move...*';
            const oppStatus = choices[opponent.id] ? '✅ **Choice Locked in!**' : '⏳ *Choosing move...*';
            const moveContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
            const moveText = `# 🎮 Rock Paper Scissors: Make Your Move!\n\n` +
                `Both players must click a button below to choose their throw.\n` +
                `Your choice is **100% secret** and will only be revealed once both players have chosen!\n\n` +
                `› 👤 <@${challenger.id}>: ${chalStatus}\n` +
                `› 👤 <@${opponent.id}>: ${oppStatus}\n\n` +
                `⏱️ You have **45 seconds** to make your throw!`;
            moveContainer.addTextDisplayComponents(ComponentsV2.text(moveText));
            return moveContainer;
        }
        const moveRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`rps_rock_${duelId}`)
            .setLabel('Rock')
            .setEmoji('🪨')
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId(`rps_paper_${duelId}`)
            .setLabel('Paper')
            .setEmoji('📰')
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId(`rps_scissors_${duelId}`)
            .setLabel('Scissors')
            .setEmoji('✂️')
            .setStyle(ButtonStyle.Primary));
        await targetMsg.edit({
            components: [renderMoveContainer(), moveRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        }).catch(() => { });
        const moveCollector = targetMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 45_000,
        });
        const moveEmojis = {
            rock: '🪨 Rock',
            paper: '📰 Paper',
            scissors: '✂️ Scissors',
        };
        moveCollector.on('collect', async (moveBtn) => {
            if (moveBtn.user.id !== challenger.id && moveBtn.user.id !== opponent.id) {
                await moveBtn.reply({
                    content: '⛔ You are not part of this duel!',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (choices[moveBtn.user.id]) {
                await moveBtn.reply({
                    content: '🔒 You have already locked in your choice! Waiting for your opponent...',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            let pickedMove;
            if (moveBtn.customId.includes('rock'))
                pickedMove = 'rock';
            else if (moveBtn.customId.includes('paper'))
                pickedMove = 'paper';
            else
                pickedMove = 'scissors';
            choices[moveBtn.user.id] = pickedMove;
            await moveBtn.reply({
                content: `🔒 You secretly threw **${moveEmojis[pickedMove]}**! Waiting for your opponent...`,
                flags: MessageFlags.Ephemeral,
            });
            // If both players have locked in, resolve immediately!
            if (choices[challenger.id] && choices[opponent.id]) {
                moveCollector.stop('resolved');
                return;
            }
            // Otherwise update public display
            await targetMsg.edit({
                components: [renderMoveContainer(), moveRow],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            }).catch(() => { });
        });
        moveCollector.on('end', async (_, reason) => {
            const chalMove = choices[challenger.id];
            const oppMove = choices[opponent.id];
            // Case 1: Both chose!
            if (chalMove && oppMove) {
                if (chalMove === oppMove) {
                    // Tie: Refund both
                    await CoinTransactionLock.grantCoins(challenger.id, wager, 'rps_duel_refund', `tie:${challenger.id}:${Date.now()}`, 'RPS duel tie refund');
                    await CoinTransactionLock.grantCoins(opponent.id, wager, 'rps_duel_refund', `tie:${opponent.id}:${Date.now()}`, 'RPS duel tie refund');
                    const tieContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
                    const tieText = `# 🤝 RPS Duel: IT'S A TIE!\n\n` +
                        `› 👤 <@${challenger.id}> threw: **${moveEmojis[chalMove]}**\n` +
                        `› 👤 <@${opponent.id}> threw: **${moveEmojis[oppMove]}**\n\n` +
                        `Both fighters threw the same move! Neither was able to gain the upper hand.\n\n` +
                        `### 💰 Refund Summary:\n` +
                        `› **All Wagers Refunded:** Both players received their \`${wager} COINS\` back in full!`;
                    tieContainer.addTextDisplayComponents(ComponentsV2.text(tieText));
                    await targetMsg.edit({ components: [tieContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                    return;
                }
                const chalWins = (chalMove === 'rock' && oppMove === 'scissors') ||
                    (chalMove === 'paper' && oppMove === 'rock') ||
                    (chalMove === 'scissors' && oppMove === 'paper');
                const winner = chalWins ? challenger : opponent;
                const loser = chalWins ? opponent : challenger;
                const winningMove = chalWins ? chalMove : oppMove;
                const losingMove = chalWins ? oppMove : chalMove;
                await CoinTransactionLock.grantCoins(winner.id, totalPot, 'rps_duel_win', `rps_pot:${winner.id}:${Date.now()}`, `Won RPS duel against ${loser.username} (+${totalPot} COINS)`);
                const winVerb = winningMove === 'rock' ? 'smashes' : winningMove === 'paper' ? 'covers' : 'cuts';
                const winContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                const winText = `# 🏆 RPS Duel: <@${winner.id}> Triumphs!\n\n` +
                    `› 👤 <@${challenger.id}> threw: **${moveEmojis[chalMove]}**\n` +
                    `› 👤 <@${opponent.id}> threw: **${moveEmojis[oppMove]}**\n\n` +
                    `💥 **${moveEmojis[winningMove]}** ${winVerb} **${moveEmojis[losingMove]}**!\n\n` +
                    `### 💰 Spoils of Victory:\n` +
                    `› 👑 **Victor:** <@${winner.id}>\n` +
                    `› 🏆 **Pot Claimed:** **${totalPot} COINS** (+${wager} net profit)\n` +
                    `› 💳 Balance credited instantly to Victus Cloud account!`;
                winContainer.addTextDisplayComponents(ComponentsV2.text(winText));
                await targetMsg.edit({ components: [winContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            // Case 2: One player timed out, one chose (Forfeit)
            if (chalMove && !oppMove) {
                await CoinTransactionLock.grantCoins(challenger.id, totalPot, 'rps_duel_forfeit', `forfeit:${challenger.id}:${Date.now()}`, `Won RPS duel by forfeit vs ${opponent.username}`);
                const fContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                fContainer.addTextDisplayComponents(ComponentsV2.text(`# 🏆 Duel Won by Forfeit!\n\n` +
                    `<@${opponent.id}> failed to choose within 45 seconds and forfeited!\n\n` +
                    `› 👑 **Victor:** <@${challenger.id}> claimed the **${totalPot} COINS** pot!`));
                await targetMsg.edit({ components: [fContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            if (oppMove && !chalMove) {
                await CoinTransactionLock.grantCoins(opponent.id, totalPot, 'rps_duel_forfeit', `forfeit:${opponent.id}:${Date.now()}`, `Won RPS duel by forfeit vs ${challenger.username}`);
                const fContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                fContainer.addTextDisplayComponents(ComponentsV2.text(`# 🏆 Duel Won by Forfeit!\n\n` +
                    `<@${challenger.id}> failed to choose within 45 seconds and forfeited!\n\n` +
                    `› 👑 **Victor:** <@${opponent.id}> claimed the **${totalPot} COINS** pot!`));
                await targetMsg.edit({ components: [fContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            // Case 3: Both timed out
            await CoinTransactionLock.grantCoins(challenger.id, wager, 'rps_duel_refund', `refund:${challenger.id}:${Date.now()}`, 'RPS duel timeout refund');
            await CoinTransactionLock.grantCoins(opponent.id, wager, 'rps_duel_refund', `refund:${opponent.id}:${Date.now()}`, 'RPS duel timeout refund');
            const expContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
            expContainer.addTextDisplayComponents(ComponentsV2.text(`# ⏳ Duel Expired\n\n` +
                `Neither player made their move in time. The duel was cancelled and all wagers were refunded.`));
            await targetMsg.edit({ components: [expContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        });
    });
    inviteCollector.on('end', async (_, reason) => {
        if (reason === 'time') {
            const timeoutC = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
            timeoutC.addTextDisplayComponents(ComponentsV2.text(`# ⏳ Challenge Expired\n\n` +
                `The Rock Paper Scissors duel challenge to <@${opponent.id}> timed out with no response.`));
            await targetMsg.edit({ components: [timeoutC], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        }
    });
}
export const rpsCommand = {
    data: new SlashCommandBuilder()
        .setName('rockpaperscissors')
        .setDescription('Play Rock Paper Scissors solo or duel a friend with COINS (OwO style: !rps <bet>)')
        .addStringOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager (or "all", "half")')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('choice')
        .setDescription('Pick rock, paper, or scissors (for solo play against bot)')
        .setRequired(false)
        .addChoices({ name: '🪨 Rock (r)', value: 'rock' }, { name: '📰 Paper (p)', value: 'paper' }, { name: '✂️ Scissors (s)', value: 'scissors' }))
        .addUserOption((opt) => opt
        .setName('opponent')
        .setDescription('Challenge another player to a 1v1 RPS Duel! (Optional)')
        .setRequired(false)),
    cooldown: 3,
    async execute(interaction) {
        let rawAmountStr = interaction.options.getString?.('amount') ?? interaction.options.getInteger?.('amount') ?? null;
        let choice = interaction.options.getString?.('choice') ?? null;
        let opponent = interaction.options.getUser?.('opponent') ?? null;
        const userId = interaction.user.id;
        // Support OwO prefix arguments: !rps 50 r, !rps @user 50, !rps 50 @user, !rps duel @user 50
        const rawMessage = interaction.message;
        if (rawMessage?.content) {
            if (rawMessage.mentions?.users?.size > 0) {
                const mentioned = rawMessage.mentions.users.find((u) => u.id !== interaction.user.id);
                if (mentioned)
                    opponent = mentioned;
            }
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            for (const part of parts) {
                const lower = part.toLowerCase();
                if (['r', 'rock', '🪨'].includes(lower)) {
                    choice = 'rock';
                }
                else if (['p', 'paper', '📰'].includes(lower)) {
                    choice = 'paper';
                }
                else if (['s', 'scissor', 'scissors', '✂️'].includes(lower)) {
                    choice = 'scissors';
                }
                else if (['all', 'max', 'half'].includes(lower) || /^\d+$/.test(lower)) {
                    rawAmountStr = lower;
                }
                else if (/^<@!?(\d+)>$/.test(part) && !opponent) {
                    const match = part.match(/\d+/);
                    if (match && interaction.client) {
                        opponent = interaction.client.users.cache.get(match[0]) || null;
                    }
                }
            }
        }
        // If an opponent was specified, launch the 2-player duel!
        if (opponent) {
            await executeRpsDuel(interaction, interaction.user, opponent, rawAmountStr);
            return;
        }
        if (!choice) {
            await interaction.reply({
                content: '❌ Please pick rock, paper, or scissors for solo play, or mention a user to duel! (e.g. `/rps amount:50 choice:rock` or `/rps amount:50 opponent:@User` or `!rps @User 50`).',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const user = await CoinTransactionLock.resolveLinkedUser(userId);
        if (!user) {
            await interaction.editReply({
                content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account. All wagers strictly use your real COINS balance.',
            });
            return;
        }
        const balance = await CoinTransactionLock.getCoinsBalance(user.email);
        const amount = CoinTransactionLock.resolveWagerAmount(rawAmountStr, balance, 100000);
        if (!amount || amount <= 0) {
            await interaction.editReply({
                content: `❌ Please specify a valid wager amount! Examples: \`/rps amount:50 choice:rock\`, \`!rps 50 r\`, \`!rps all paper\`.`,
            });
            return;
        }
        const CHOICES = ['rock', 'paper', 'scissors'];
        const tx = await CoinTransactionLock.executeWagerTransaction(userId, amount, 'gambling_rps', `rps:${userId}:${Date.now()}`, `RPS wager of ${amount} COINS on ${choice}`, async () => {
            const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
            let isWin = false;
            let isTie = false;
            let payoutAmount = 0;
            if (choice === botChoice) {
                isTie = true;
                payoutAmount = amount; // Refund wager
            }
            else if ((choice === 'rock' && botChoice === 'scissors') ||
                (choice === 'paper' && botChoice === 'rock') ||
                (choice === 'scissors' && botChoice === 'paper')) {
                isWin = true;
                payoutAmount = amount * 2; // 2x payout
            }
            else {
                payoutAmount = 0; // Loss
            }
            return {
                won: isWin || isTie,
                payoutAmount,
                payload: { botChoice, isTie, isWin, choice },
            };
        });
        if (tx.insufficientBalance || !tx.success) {
            await interaction.editReply({
                content: `❌ ${tx.error || 'Transaction failed.'}`,
            });
            return;
        }
        const { botChoice, isTie, isWin } = tx.payload;
        const emojis = {
            rock: '🪨 Rock',
            paper: '📰 Paper',
            scissors: '✂️ Scissors',
        };
        const accent = isTie
            ? ComponentsV2.Accents.warning
            : isWin
                ? ComponentsV2.Accents.success
                : ComponentsV2.Accents.danger;
        const container = ComponentsV2.baseContainer(accent);
        const outcomeText = isTie
            ? `🤝 **TIE / PUSH!** Both chose ${emojis[choice]}. Your wager was fully refunded.`
            : isWin
                ? `🏆 **YOU WON!** ${emojis[choice]} beats ${emojis[botChoice]}!`
                : `💀 **YOU LOST!** ${emojis[botChoice]} beats ${emojis[choice]}.`;
        const netStr = isTie
            ? `\`0 COINS (Refunded)\``
            : isWin
                ? `**+${amount} COINS 🏆**`
                : `**-${amount} COINS 💀**`;
        const text = `# 🪨 Rock Paper Scissors: ${isTie ? 'TIE' : isWin ? 'VICTORY!' : 'DEFEAT'}\n\n` +
            `${outcomeText}\n\n` +
            `› **Your Throw:** ${emojis[choice]}\n` +
            `› **Bot Throw:** ${emojis[botChoice]}\n` +
            `› **Wager:** \`${amount} COINS\`\n` +
            `› **Net Outcome:** ${netStr}\n\n` +
            `### 💳 Updated Balance:\n` +
            `› **${tx.newBalance} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};
export const rpsDuelCommand = {
    data: new SlashCommandBuilder()
        .setName('rps-duel')
        .setDescription('Challenge another player to a 1v1 Rock Paper Scissors Duel for COINS!')
        .addUserOption((opt) => opt
        .setName('opponent')
        .setDescription('The player to challenge')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager (or "all", "half")')
        .setRequired(true)),
    cooldown: 3,
    async execute(interaction) {
        const opponent = interaction.options.getUser?.('opponent');
        const rawAmountStr = interaction.options.getString?.('amount');
        if (!opponent) {
            await interaction.reply({
                content: '❌ Please specify an opponent to duel! e.g. `/rps-duel opponent:@user amount:50`',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await executeRpsDuel(interaction, interaction.user, opponent, rawAmountStr);
    },
};
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = [
    { rank: 'A', value: 11 },
    { rank: '2', value: 2 },
    { rank: '3', value: 3 },
    { rank: '4', value: 4 },
    { rank: '5', value: 5 },
    { rank: '6', value: 6 },
    { rank: '7', value: 7 },
    { rank: '8', value: 8 },
    { rank: '9', value: 9 },
    { rank: '10', value: 10 },
    { rank: 'J', value: 10 },
    { rank: 'Q', value: 10 },
    { rank: 'K', value: 10 },
];
function createShuffledDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const r of RANKS) {
            deck.push({ suit, rank: r.rank, value: r.value });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}
function calculateHand(hand) {
    let total = 0;
    let aces = 0;
    for (const c of hand) {
        total += c.value;
        if (c.rank === 'A')
            aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return {
        total,
        isBust: total > 21,
        isBlackjack: hand.length === 2 && total === 21,
    };
}
function formatCards(hand, hideSecond = false) {
    if (hideSecond && hand.length >= 2) {
        return `\`[ ${hand[0].suit} ${hand[0].rank} ]\` \`[ 🎴 ? ]\` (Value: **${hand[0].value} + ?**)`;
    }
    const cardsStr = hand.map((c) => `\`[ ${c.suit} ${c.rank} ]\``).join(' ');
    const { total, isBust, isBlackjack } = calculateHand(hand);
    let tag = `Value: **${total}**`;
    if (isBlackjack)
        tag = `Value: **21 (Blackjack!)** 🔥`;
    else if (isBust)
        tag = `Value: **${total} (Bust!)** 💥`;
    return `${cardsStr} (${tag})`;
}
export const blackjackCommand = {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Play Blackjack (21) against dealer with Victus Cloud COINS (OwO style: !bj <bet>)')
        .addStringOption((opt) => opt
        .setName('amount')
        .setDescription('Amount of COINS to wager (or "all", "half")')
        .setRequired(true)),
    cooldown: 5,
    async execute(interaction) {
        let rawAmountStr = interaction.options.getString?.('amount') ?? interaction.options.getInteger?.('amount') ?? null;
        const userId = interaction.user.id;
        // Support OwO prefix arguments: !bj 100, !bj all, !bj half
        const rawMessage = interaction.message;
        if (rawMessage?.content) {
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            for (const part of parts) {
                const lower = part.toLowerCase();
                if (['all', 'max', 'half'].includes(lower) || /^\d+$/.test(lower)) {
                    rawAmountStr = lower;
                }
            }
        }
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const user = await CoinTransactionLock.resolveLinkedUser(userId);
        if (!user) {
            await interaction.editReply({
                content: '⚠️ **Account Not Linked!** Run `/link` to connect your Victus Cloud account. Blackjack wagers use real COINS balance.',
            });
            return;
        }
        const balance = await CoinTransactionLock.getCoinsBalance(user.email);
        const amount = CoinTransactionLock.resolveWagerAmount(rawAmountStr, balance, 100000);
        if (!amount || amount <= 0) {
            await interaction.editReply({
                content: `❌ Please specify a valid wager amount! Examples: \`/blackjack amount:100\`, \`!bj 100\`, \`!bj all\`, \`!bj half\`.`,
            });
            return;
        }
        // Deduct initial wager atomically
        const deductRes = await CoinTransactionLock.deductWager(userId, amount, 'gambling_bj', `bj:${userId}:${Date.now()}`, `Blackjack wager of ${amount} COINS`);
        if (!deductRes.success) {
            await interaction.editReply({
                content: `❌ ${deductRes.error || 'Failed to deduct wager.'}`,
            });
            return;
        }
        const deck = createShuffledDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        let currentWager = amount;
        let finished = false;
        const playerStats = calculateHand(playerHand);
        const dealerStats = calculateHand(dealerHand);
        // Check for immediate natural Blackjack
        if (playerStats.isBlackjack) {
            finished = true;
            let payout = 0;
            let outcomeTitle = '';
            let outcomeDesc = '';
            let accent = ComponentsV2.Accents.success;
            if (dealerStats.isBlackjack) {
                // Push
                payout = currentWager;
                await CoinTransactionLock.grantCoins(userId, payout, 'gambling_bj_push', `bj_push:${userId}`, 'Blackjack push refund');
                outcomeTitle = 'PUSH (TIE)';
                outcomeDesc = '🤝 Both you and the dealer hit a natural Blackjack! Your wager was refunded.';
                accent = ComponentsV2.Accents.warning;
            }
            else {
                // Natural 3:2 payout (2.5x)
                payout = Math.floor(currentWager * 2.5);
                await CoinTransactionLock.grantCoins(userId, payout, 'gambling_bj_win', `bj_win:${userId}`, 'Natural Blackjack victory');
                outcomeTitle = 'BLACKJACK! 🔥';
                outcomeDesc = `🎉 **NATURAL BLACKJACK!** You scored 21 on the deal and won a 3:2 payout (**+${payout - currentWager} COINS**)!`;
            }
            const updatedBal = await CoinTransactionLock.getCoinsBalance(user.email);
            const container = ComponentsV2.baseContainer(accent);
            const text = `# 🃏 Blackjack: ${outcomeTitle}\n\n` +
                `${outcomeDesc}\n\n` +
                `› **Your Hand:** ${formatCards(playerHand)}\n` +
                `› **Dealer Hand:** ${formatCards(dealerHand)}\n\n` +
                `› **Total Wager:** \`${currentWager} COINS\`\n` +
                `› **Payout:** **${payout} COINS**\n\n` +
                `### 💳 Current Balance:\n` +
                `› **${updatedBal} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        // Check if user has enough balance to double down
        const remainingBal = deductRes.newBalance ?? 0;
        const canDouble = remainingBal >= currentWager;
        const hitBtn = new ButtonBuilder()
            .setCustomId(`bj_hit_${interaction.id}`)
            .setLabel('Hit')
            .setEmoji('🃏')
            .setStyle(ButtonStyle.Primary);
        const standBtn = new ButtonBuilder()
            .setCustomId(`bj_stand_${interaction.id}`)
            .setLabel('Stand')
            .setEmoji('🛑')
            .setStyle(ButtonStyle.Secondary);
        const doubleBtn = new ButtonBuilder()
            .setCustomId(`bj_double_${interaction.id}`)
            .setLabel('Double Down (2x)')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!canDouble);
        const row = new ActionRowBuilder().addComponents(hitBtn, standBtn, doubleBtn);
        const renderGameContainer = (accentColor = ComponentsV2.Accents.info) => {
            const container = ComponentsV2.baseContainer(accentColor);
            const text = `# 🃏 Blackjack: Game in Progress\n\n` +
                `› **Your Hand:** ${formatCards(playerHand)}\n` +
                `› **Dealer Hand:** ${formatCards(dealerHand, true)}\n\n` +
                `› **Wager:** \`${currentWager} COINS\`\n\n` +
                `_Choose your action below within 45 seconds:_`;
            container.addTextDisplayComponents(ComponentsV2.text(text));
            return container;
        };
        await interaction.editReply({
            components: [renderGameContainer(), row],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        const replyMsg = await interaction.fetchReply();
        const collector = replyMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 45_000,
        });
        const finishGame = async (reason, extraDouble = false) => {
            if (finished)
                return;
            finished = true;
            collector.stop();
            if (reason === 'bust') {
                const updatedBal = await CoinTransactionLock.getCoinsBalance(user.email);
                const bustContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
                const text = `# 🃏 Blackjack: BUST! 💥\n\n` +
                    `You exceeded 21 and busted!\n\n` +
                    `› **Your Hand:** ${formatCards(playerHand)}\n` +
                    `› **Dealer Hand:** ${formatCards(dealerHand, false)}\n\n` +
                    `› **Net Outcome:** **-${currentWager} COINS 💀**\n\n` +
                    `### 💳 Current Balance:\n` +
                    `› **${updatedBal} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
                bustContainer.addTextDisplayComponents(ComponentsV2.text(text));
                await interaction.editReply({ components: [bustContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
                return;
            }
            // Dealer's Turn: Dealer must hit on soft/hard < 17
            let dEval = calculateHand(dealerHand);
            while (dEval.total < 17) {
                dealerHand.push(deck.pop());
                dEval = calculateHand(dealerHand);
            }
            const pEval = calculateHand(playerHand);
            let won = false;
            let isTie = false;
            let payout = 0;
            if (dEval.isBust) {
                won = true;
                payout = currentWager * 2;
            }
            else if (pEval.total > dEval.total) {
                won = true;
                payout = currentWager * 2;
            }
            else if (pEval.total === dEval.total) {
                isTie = true;
                payout = currentWager;
            }
            else {
                won = false;
                payout = 0;
            }
            if (payout > 0) {
                await CoinTransactionLock.grantCoins(userId, payout, isTie ? 'gambling_bj_push' : 'gambling_bj_win', `bj_pay:${userId}:${Date.now()}`, isTie ? 'Blackjack push refund' : `Blackjack win of ${payout} COINS`);
            }
            const finalBal = await CoinTransactionLock.getCoinsBalance(user.email);
            const accent = isTie ? ComponentsV2.Accents.warning : won ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger;
            const finalContainer = ComponentsV2.baseContainer(accent);
            const outcomeTitle = isTie ? 'PUSH (TIE) 🤝' : won ? 'VICTORY! 🏆' : 'DEALER WINS 💀';
            const outcomeMessage = isTie
                ? `🤝 You and the dealer tied with **${pEval.total}**! Your wager was fully refunded.`
                : won
                    ? `🎉 ${dEval.isBust ? 'Dealer busted!' : `Your **${pEval.total}** beat dealer's **${dEval.total}**!`} You won **+${currentWager} COINS**!`
                    : `💀 Dealer's **${dEval.total}** beat your **${pEval.total}**. Better luck next round!`;
            const text = `# 🃏 Blackjack: ${outcomeTitle}\n\n` +
                `${outcomeMessage}\n\n` +
                `› **Your Hand:** ${formatCards(playerHand)}\n` +
                `› **Dealer Hand:** ${formatCards(dealerHand)}\n\n` +
                `› **Total Wager:** \`${currentWager} COINS\`\n` +
                `› **Net Outcome:** **${isTie ? '`0 COINS (Refunded)`' : won ? `+${currentWager} COINS 🏆` : `-${currentWager} COINS 💀`}**\n\n` +
                `### 💳 Current Balance:\n` +
                `› **${finalBal} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;
            finalContainer.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.editReply({ components: [finalContainer], flags: ComponentsV2.IS_COMPONENTS_V2 }).catch(() => { });
        };
        collector.on('collect', async (btn) => {
            if (btn.user.id !== userId) {
                await btn.reply({ content: '❌ Only the player who started this game can click these buttons.', flags: MessageFlags.Ephemeral });
                return;
            }
            await btn.deferUpdate();
            if (btn.customId.startsWith('bj_hit_')) {
                playerHand.push(deck.pop());
                const pVal = calculateHand(playerHand);
                if (pVal.isBust) {
                    await finishGame('bust');
                    return;
                }
                if (pVal.total === 21) {
                    await finishGame('dealer');
                    return;
                }
                // After hitting once, double down is disabled
                doubleBtn.setDisabled(true);
                await interaction.editReply({
                    components: [renderGameContainer(), row],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                }).catch(() => { });
                return;
            }
            if (btn.customId.startsWith('bj_double_')) {
                // Deduct second wager
                const doubleDeduct = await CoinTransactionLock.deductWager(userId, amount, 'gambling_bj_double', `bj_dbl:${userId}:${Date.now()}`, `Blackjack Double Down additional wager of ${amount} COINS`);
                if (!doubleDeduct.success) {
                    await interaction.followUp({
                        content: `❌ Could not double down: ${doubleDeduct.error}`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                currentWager += amount;
                playerHand.push(deck.pop());
                const pVal = calculateHand(playerHand);
                if (pVal.isBust) {
                    await finishGame('bust', true);
                }
                else {
                    await finishGame('dealer', true);
                }
                return;
            }
            if (btn.customId.startsWith('bj_stand_')) {
                await finishGame('dealer');
                return;
            }
        });
        collector.on('end', async () => {
            if (!finished) {
                // Auto-stand on timeout so user's coins are never abandoned!
                await finishGame('dealer');
            }
        });
    },
};
