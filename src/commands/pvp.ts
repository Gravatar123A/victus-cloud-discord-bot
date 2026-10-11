import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, type Client } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { pvpService } from '../services/pvpService.js';
import type { PvpMatch } from '../services/pvpStore.js';
import { PVP_MAX_STAKE, type PvpGame } from '../services/pvpRules.js';
import { rpgService } from '../services/rpgService.js';
import { withGameLock } from '../services/gameLock.js';
import { logger } from '../utils/logger.js';

const TITLES = { rps: 'Rock Paper Scissors', tictactoe: 'Tic-Tac-Toe', connect4: 'Connect Four', battle: 'Mob Battle' };
const flags = ComponentsV2.IS_COMPONENTS_V2;

function button(match: PvpMatch, action: string, label: string, style = ButtonStyle.Secondary, value = '') {
    return new ButtonBuilder().setCustomId(`pvp:${action}:${match.id}:${match.revision}:${value}`).setLabel(label).setStyle(style);
}

export function pvpCard(match: PvpMatch) {
    const a = `<@${match.players[0].discordId}>`, b = `<@${match.players[1].discordId}>`;
    let body = `${a} vs ${b}\n**Stake per player: ${match.stake} COINS · Full pot: ${match.stake * 2} COINS**\n\n`;
    const c = ComponentsV2.baseContainer(match.status === 'complete' ? ComponentsV2.Accents.success : ComponentsV2.Accents.primary);
    if (match.status === 'invited') {
        body += `${b}, accept this stake <t:${Math.ceil(match.expiresAt / 1000)}:R>. No coins move until you accept.\n\n` +
            'Acceptance deducts both stakes from Paymenter. Winner gets the full pot (net profit = one stake); draws refund both. ' +
            'Each turn has 60 seconds. A missed turn or forfeit loses the stake; RPS refunds both if neither chooses.\n' +
            'A 10-second cooldown applies after the match. You can only be in one match at a time.';
    } else if (match.status === 'funding') {
        body += 'Confirming both stakes with Paymenter. Play starts only after both deductions succeed. If funding fails, confirmed stakes are refunded. Recovery runs automatically.';
    } else if (match.status === 'active') {
        body += `Both stakes are deducted and held for this match. Deadline: <t:${Math.ceil(match.expiresAt / 1000)}:R>.\n\n`;
        if (match.game === 'rps') body += `${a}: ${match.choices[0] ? 'choice locked' : 'choosing'}\n${b}: ${match.choices[1] ? 'choice locked' : 'choosing'}\n\nChoose below. Choices remain hidden until the result.`;
        else body += `Turn: <@${match.players[match.turn].discordId}> (${match.turn === 0 ? 'X / red' : 'O / yellow'}).`;
    } else {
        body += `${match.reason || 'Match finished.'}\n\n`;
        if (match.winner != null) body += `**Winner: <@${match.players[match.winner].discordId}>**\n${match.stake * 2} COINS ${match.status === 'complete' ? 'paid to their Paymenter balance' : 'awaiting Paymenter confirmation'}.\n`;
        else if (match.payments.some(p => p.kind === 'refund')) body += match.status === 'complete' ? 'Confirmed stakes have been refunded to Paymenter.\n' : 'Stake refunds are pending with Paymenter.\n';
        if (match.status === 'settling') body += 'Settlement retries automatically with the same transaction reference. No new stake is taken.\n';
        if (match.game === 'rps' && match.choices.some(Boolean)) body += `\n${a}: **${match.choices[0] || 'no choice'}** · ${b}: **${match.choices[1] || 'no choice'}**`;
        if (match.game === 'battle' && match.battleRolls) body += `\nCombat scores: ${match.battleRolls.map(score => score.toFixed(1)).join(' vs ')}`;
    }
    if (match.game === 'connect4' && match.status !== 'invited') {
        body += '\n\n' + Array.from({ length: 6 }, (_, row) => match.board.slice(row * 7, row * 7 + 7).map(cell => cell === null ? '⚪' : cell === 0 ? '🔴' : '🟡').join('')).join('\n') + '\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
    }
    c.addTextDisplayComponents(ComponentsV2.text(`# ${TITLES[match.game]}\n\n${body}`));
    if (match.status === 'invited') {
        c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            button(match, 'accept', `Accept ${match.stake} COINS`, ButtonStyle.Success),
            button(match, 'decline', 'Decline', ButtonStyle.Danger), button(match, 'cancel', 'Cancel challenge')));
    } else if (match.status === 'active' && match.game === 'rps') {
        c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...['rock', 'paper', 'scissors'].map(choice => button(match, 'choose', choice, ButtonStyle.Primary, choice))));
    } else if (match.game === 'tictactoe' && ['active', 'complete', 'settling'].includes(match.status)) {
        for (let row = 0; row < 3; row++) c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...match.board.slice(row * 3, row * 3 + 3).map((cell, col) => button(match, 'move', cell === null ? '·' : cell === 0 ? 'X' : 'O',
                cell === null ? ButtonStyle.Secondary : cell === 0 ? ButtonStyle.Primary : ButtonStyle.Success, String(row * 3 + col))
                .setDisabled(cell !== null || match.status !== 'active'))));
    } else if (match.status === 'active' && match.game === 'connect4') {
        for (const cols of [[0, 1, 2, 3], [4, 5, 6]]) c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...cols.map(col => button(match, 'move', `Drop ${col + 1}`, ButtonStyle.Primary, String(col)).setDisabled(match.board[col] !== null))));
    }
    if (match.status === 'active') c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(match, 'forfeit', 'Forfeit stake', ButtonStyle.Danger), button(match, 'refresh', 'Refresh')));
    if (['funding', 'settling'].includes(match.status)) c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button(match, 'refresh', 'Check payment')));
    return c;
}

export async function createPvpChallenge(interaction: any, game: PvpGame, amountOption = 'amount') {
    await interaction.deferReply({ flags });
    let match: PvpMatch | undefined;
    try {
        const opponent = interaction.options.getUser('opponent', true);
        if (!interaction.guild || !await interaction.guild.members.fetch(opponent.id).catch(() => null)) throw new Error('Choose a player who is in this server.');
        let mobPowers: [number, number] | undefined;
        if (game === 'battle') {
            const a = await rpgService.inventory(interaction.user.id), b = await rpgService.inventory(opponent.id);
            mobPowers = [a.mobs_json[0]?.power || 0, b.mobs_json[0]?.power || 0];
        }
        match = await pvpService.create({ game, challenger: interaction.user, opponent,
            stake: interaction.options.getInteger(amountOption, true), guildId: interaction.guildId,
            channelId: interaction.channelId, mobPowers });
        const message = await interaction.editReply({ components: [pvpCard(match)], flags, allowedMentions: { users: [opponent.id] } });
        await pvpService.attachMessage(match.id, message.id);
    } catch (error: any) {
        if (match) await pvpService.action(match.id, interaction.user.id, 'cancel').catch(() => {});
        await interaction.editReply({ components: [ComponentsV2.errorContainer('Challenge not started', error?.message || 'Try again shortly.')], flags });
    }
}

async function handlePvpButton(interaction: any) {
    if (!interaction.customId.startsWith('pvp:')) return;
    await interaction.deferUpdate();
    const [, action, id, revision, value] = interaction.customId.split(':');
    try {
        await withGameLock(`pvp-ui:${id}`, async () => {
            const match = await pvpService.action(id, interaction.user.id, action, value, Number(revision));
            await interaction.editReply({ components: [pvpCard(match)], flags, allowedMentions: { parse: [] } });
            if (action === 'choose' && match.status === 'active') await interaction.followUp({ content: 'Your choice is locked. The other player cannot see it.', flags: MessageFlags.Ephemeral });
        });
    } catch (error: any) {
        await interaction.followUp({ content: error?.message || 'The action could not complete. Saved payments will retry automatically.', flags: MessageFlags.Ephemeral });
    }
}

function command(game: 'rps' | 'tictactoe' | 'connect4'): Command {
    return {
        data: new SlashCommandBuilder().setName(game).setDescription(`Challenge another player to ${TITLES[game]} for real COINS`).setDMPermission(false)
            .addUserOption(option => option.setName('opponent').setDescription('The other player must accept before any coins move').setRequired(true))
            .addIntegerOption(option => option.setName('amount').setDescription('COINS staked by EACH player; winner receives both stakes').setRequired(true).setMinValue(1).setMaxValue(PVP_MAX_STAKE)),
        execute: interaction => createPvpChallenge(interaction, game),
        ...(game === 'rps' ? { handleButton: handlePvpButton } : {}),
    };
}
export const rpsCommand = command('rps');
export const ticTacToeCommand = command('tictactoe');
export const connect4Command = command('connect4');

let workerStarted = false;
export function startPvpRecovery(client: Client) {
    if (workerStarted) return;
    workerStarted = true;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            for (const changed of await pvpService.recover()) {
                if (!changed.messageId) continue;
                await withGameLock(`pvp-ui:${changed.id}`, async () => {
                    const current = await pvpService.get(changed.id);
                    if (!current) return;
                    const channel = await client.channels.fetch(current.channelId).catch(() => null);
                    if (channel?.isTextBased() && 'messages' in channel) {
                        const message = await channel.messages.fetch(current.messageId!).catch(() => null);
                        await message?.edit({ components: [pvpCard(current)], flags, allowedMentions: { parse: [] } }).catch(() => {});
                    }
                });
            }
        } catch { logger.warn('PvP recovery deferred; saved matches will retry.'); }
        finally { running = false; }
    };
    void tick();
    setInterval(() => void tick(), 5000).unref();
}
