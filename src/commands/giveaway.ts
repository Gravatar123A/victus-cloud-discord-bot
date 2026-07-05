import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    Client, 
    MessageFlags, 
    ModalBuilder, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    GuildMember
} from 'discord.js';
import type { Command, Giveaway } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { calculateLevel } from '../utils/vccrs.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const wizardSessions = new Map<string, any>();

function getSessionKey(userId: string, guildId: string): string {
    return `${userId}-${guildId}`;
}

function parseDuration(str: string): number {
    const num = parseFloat(str);
    const unit = str.replace(String(num), '').trim().toLowerCase();
    if (isNaN(num)) return 0;
    
    switch (unit) {
        case 'm':
        case 'min':
        case 'minute':
        case 'minutes':
            return num * 60 * 1000;
        case 'h':
        case 'hr':
        case 'hour':
        case 'hours':
            return num * 60 * 60 * 1000;
        case 'd':
        case 'day':
        case 'days':
            return num * 24 * 60 * 60 * 1000;
        default:
            return num * 1000; // Default seconds
    }
}

function formatDurationText(ms: number): string {
    let seconds = Math.floor(ms / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    let days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function renderGiveawayWizard(session: any): any {
    const page = session.page;
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);

    let title = `Giveaway Builder • Page ${page}/3`;
    let desc = '';

    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_wiz:prev:${page}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
        new ButtonBuilder().setCustomId(`giveaway_wiz:next:${page}`).setLabel('Next ➡️').setStyle(ButtonStyle.Primary).setDisabled(page === 3),
        new ButtonBuilder().setCustomId(`giveaway_wiz:cancel`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
    );

    const actionRows: any[] = [];

    switch (page) {
        case 1:
            desc = `### Page 1: Basic Specifications\n` +
                `Configure the core metrics of your giveaway item.\n\n` +
                `› **Prize:** ${session.prize ? `**"${session.prize}"**` : '*Not set (Required)*'}\n` +
                `› **Duration:** ${session.durationText ? `\`${session.durationText}\`` : '*Not set (Required)*'} (${session.durationMs ? `${formatDurationText(session.durationMs)}` : '0ms'})\n` +
                `› **Winners Count:** \`${session.winnersCount}\` winner${session.winnersCount === 1 ? '' : 's'}\n\n` +
                `Press the button below to define these parameters.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('giveaway_wiz:modal:basic').setLabel('Edit Basic Info').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 2:
            desc = `### Page 2: Participation Filters\n` +
                `Configure eligibility restrictions targeting level, server boosters, role memberships, and invite counts.\n\n` +
                `› **Target Role:** ${session.reqRoleId ? `<@&${session.reqRoleId}>` : '*None*'}\n` +
                `› **Min Level:** \`Level ${session.reqLevel}\`\n` +
                `› **Min Invites:** \`${session.reqInvites}\` invites\n` +
                `› **Require Booster:** \`${session.reqBooster ? 'Yes' : 'No'}\`\n\n` +
                `Press the button below to edit entries filters.`;

            actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('giveaway_wiz:modal:reqs').setLabel('Edit Requirements').setStyle(ButtonStyle.Secondary)
            ));
            break;

        case 3:
            desc = `### Page 3: Launch Parameters\n` +
                `Review and launch the giveaway to a target text channel.\n\n` +
                `› **Prize Item:** **"${session.prize || 'Missing prize!'}"**\n` +
                `› **Winners Allocation:** \`${session.winnersCount}\` winner(s)\n` +
                `› **Requirements Status:** ${session.reqRoleId || session.reqLevel > 0 || session.reqInvites > 0 || session.reqBooster ? '🟢 Active filters' : '⚪ Free entry'}\n\n` +
                `Select a target channel below to publish and run the giveaway.`;

            const channelSelect = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('giveaway_wiz:launch').setLabel('Launch Giveaway 🎉').setStyle(ButtonStyle.Success).setDisabled(!session.prize || !session.durationMs)
            );
            actionRows.push(channelSelect);
            break;
    }

    c.addTextDisplayComponents(ComponentsV2.text(`# ${title}\n\n${desc}`))
        .addSeparatorComponents(ComponentsV2.separator());

    actionRows.forEach(row => c.addActionRowComponents(row));
    c.addActionRowComponents(navRow);

    return c;
}

function buildGiveawayCard(giveaway: Giveaway, participantCount: number): any {
    const isEnded = giveaway.status === 'ended';
    const isPaused = giveaway.status === 'paused';

    const accent = isEnded ? ComponentsV2.Accents.danger
        : isPaused ? ComponentsV2.Accents.warning
        : ComponentsV2.Accents.success;

    const c = ComponentsV2.baseContainer(accent);

    const statusBadge = isEnded ? '🔴 ENDED' : isPaused ? '⏸️ PAUSED' : '🎉 ACTIVE';
    
    let body = `-# 🎁 GIVEAWAY • #${giveaway.id.slice(0, 8)} • ${statusBadge}\n` +
        `# ${giveaway.prize}\n\n` +
        `› **Winners:** \`${giveaway.winners_count}\` target slot(s)\n` +
        `› **Participants count:** \`${participantCount}\` entered\n`;

    if (isEnded) {
        if (giveaway.winners && giveaway.winners.length > 0) {
            body += `\n🏆 **Winners:** ${giveaway.winners.map(w => `<@${w}>`).join(', ')}`;
        } else {
            body += `\n🏆 **Winners:** _No participants entered._`;
        }
        body += `\n\nEnded: <t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>`;
    } else {
        body += `› **Ends:** <t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>)\n\n`;
        
        const reqs = [];
        const rId = giveaway.requirements?.roles?.[0];
        const lvl = giveaway.requirements?.level ?? 0;
        const invs = giveaway.requirements?.invites ?? 0;
        const bst = giveaway.requirements?.booster ?? false;

        if (rId) reqs.push(`· Must have role: <@&${rId}>`);
        if (lvl > 0) reqs.push(`· Must be level: **\`${lvl}\`** or above`);
        if (invs > 0) reqs.push(`· Must have invited: **\`${invs}\`** or more members`);
        if (bst) reqs.push(`· Must be a Server Booster`);

        if (reqs.length > 0) {
            body += `⚠️ **Entry Requirements:**\n${reqs.join('\n')}\n\n`;
        } else {
            body += `✨ **Entry Requirements:** None! Open to everyone.\n\n`;
        }

        body += `Click the **Participate 🎉** button below to register!`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body))
        .addSeparatorComponents(ComponentsV2.separator());

    if (!isEnded) {
        c.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`giveaway:enter:${giveaway.id}`).setLabel('Participate 🎉').setStyle(ButtonStyle.Success).setDisabled(isPaused)
        ));
    }

    return c;
}

export const giveawayCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create, inspect, control, and reroll giveaways')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('create').setDescription('Open the premium interactive creation wizard')
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('View all active giveaways')
        )
        .addSubcommand(sub =>
            sub.setName('end').setDescription('Halt a giveaway and select winners immediately')
                .addStringOption(o => o.setName('id').setDescription('Giveaway ID (UUID)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('reroll').setDescription('Reroll winners for an ended giveaway')
                .addStringOption(o => o.setName('id').setDescription('Giveaway ID (UUID)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('pause').setDescription('Pause ends_at timer of a giveaway')
                .addStringOption(o => o.setName('id').setDescription('Giveaway ID (UUID)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('resume').setDescription('Resume ends_at timer of a giveaway')
                .addStringOption(o => o.setName('id').setDescription('Giveaway ID (UUID)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('delete').setDescription('Delete a giveaway')
                .addStringOption(o => o.setName('id').setDescription('Giveaway ID (UUID)').setRequired(true))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);

        if (sub === 'create') {
            const key = getSessionKey(interaction.user.id, interaction.guildId!);
            wizardSessions.set(key, {
                page: 1,
                prize: '',
                durationText: '',
                durationMs: 0,
                winnersCount: 1,
                reqRoleId: '',
                reqLevel: 0,
                reqInvites: 0,
                reqBooster: false
            });

            const container = renderGiveawayWizard(wizardSessions.get(key));
            await interaction.reply({
                components: [container],
                flags: V2 | EPH
            });
        }
        else if (sub === 'list') {
            await interaction.deferReply({ flags: EPH });
            const list = await supabase.listGiveaways(interaction.guildId!);
            const active = list.filter(g => g.status !== 'ended');

            if (active.length === 0) {
                await interaction.editReply({
                    components: [ComponentsV2.warningContainer('No Active Giveaways', 'There are no active lotteries in this server. Use `/giveaway create` to launch one.')],
                    flags: V2
                });
                return;
            }

            let body = `# 🎁 Active Giveaways Fleet\n`;
            active.forEach(g => {
                body += `### Giveaway ID: **\`${g.id}\`**\n` +
                    `› **Prize:** **"${g.prize}"**\n` +
                    `› **Winners Slots:** \`${g.winners_count}\` slot(s)\n` +
                    `› **Ends:** <t:${Math.floor(new Date(g.ends_at).getTime() / 1000)}:R>\n\n`;
            });

            await interaction.editReply({
                components: [ComponentsV2.baseContainer(ComponentsV2.Accents.primary).addTextDisplayComponents(ComponentsV2.text(body))],
                flags: V2
            });
        }
        else if (sub === 'end') {
            await interaction.deferReply({ flags: EPH });
            const id = interaction.options.getString('id', true).trim();
            const giveaway = await supabase.getGiveaway(id);

            if (!giveaway || giveaway.status === 'ended') {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Invalid Action', 'Giveaway is either not found or has already ended.')],
                    flags: V2
                });
                return;
            }

            await endGiveaway(interaction.client, giveaway);
            await interaction.editReply({
                components: [ComponentsV2.successContainer('Giveaway Ended', `Giveaway **\`${id}\`** has been ended and winners selected!`)],
                flags: V2
            });
        }
        else if (sub === 'reroll') {
            await interaction.deferReply({ flags: EPH });
            const id = interaction.options.getString('id', true).trim();
            const giveaway = await supabase.getGiveaway(id);

            if (!giveaway || giveaway.status !== 'ended') {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Invalid Action', 'Giveaway is either not found or has not ended yet.')],
                    flags: V2
                });
                return;
            }

            const participants = giveaway.participants || [];
            if (participants.length === 0) {
                await interaction.editReply({
                    components: [ComponentsV2.warningContainer('Reroll Failed', 'No participants entered this giveaway.')],
                    flags: V2
                });
                return;
            }

            const picked: string[] = [];
            const ids = [...participants];
            for (let i = 0; i < Math.min(giveaway.winners_count, ids.length); i++) {
                const index = Math.floor(Math.random() * ids.length);
                picked.push(ids.splice(index, 1)[0]);
            }

            await supabase.updateGiveaway(id, { winners: picked });
            
            const channel = interaction.guild?.channels.cache.get(giveaway.channel_id);
            if (channel && channel.type === ChannelType.GuildText) {
                const rerollContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.purple)
                    .addTextDisplayComponents(ComponentsV2.text(
                        `-# 🎁 GIVEAWAY REROLL • #${id.slice(0, 8)}\n` +
                        `# Reroll Complete! 🏆\n\n` +
                        `A new set of winners has been rolled for **"${giveaway.prize}"**!\n\n` +
                        `› **New Winners:** ${picked.map(w => `<@${w}>`).join(', ')}\n` +
                        `› **Hosted by:** <@${giveaway.host_id}>\n\n` +
                        `Claim your reward by contacting the host!`
                    ))
                    .addSeparatorComponents(ComponentsV2.separator());

                await (channel as any).send({
                    content: `🏆 **Reroll Winners:** ${picked.map(w => `<@${w}>`).join(', ')}!`,
                    components: [rerollContainer],
                    flags: V2
                });
            }

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Rerolled', `Giveaway **\`${id}\`** has been rerolled. Winners: ${picked.map(w => `<@${w}>`).join(', ')}`)],
                flags: V2
            });
        }
        else if (sub === 'pause') {
            await interaction.deferReply({ flags: EPH });
            const id = interaction.options.getString('id', true).trim();
            const success = await supabase.updateGiveaway(id, { status: 'paused' });

            if (success) {
                const giveaway = await supabase.getGiveaway(id);
                if (giveaway) {
                    const card = buildGiveawayCard(giveaway, giveaway.participants.length);
                    const channel = interaction.guild?.channels.cache.get(giveaway.channel_id);
                    if (channel && 'messages' in channel) {
                        const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                        if (message) await message.edit({ components: [card], flags: V2 }).catch(() => {});
                    }
                }

                await interaction.editReply({
                    components: [ComponentsV2.successContainer('Paused', `Giveaway **\`${id}\`** has been paused.`)],
                    flags: V2
                });
            } else {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('System Error', 'Failed to pause giveaway.')],
                    flags: V2
                });
            }
        }
        else if (sub === 'resume') {
            await interaction.deferReply({ flags: EPH });
            const id = interaction.options.getString('id', true).trim();
            const success = await supabase.updateGiveaway(id, { status: 'active' });

            if (success) {
                const giveaway = await supabase.getGiveaway(id);
                if (giveaway) {
                    const card = buildGiveawayCard(giveaway, giveaway.participants.length);
                    const channel = interaction.guild?.channels.cache.get(giveaway.channel_id);
                    if (channel && 'messages' in channel) {
                        const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                        if (message) await message.edit({ components: [card], flags: V2 }).catch(() => {});
                    }
                }

                await interaction.editReply({
                    components: [ComponentsV2.successContainer('Resumed', `Giveaway **\`${id}\`** has been resumed.`)],
                    flags: V2
                });
            } else {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('System Error', 'Failed to resume giveaway.')],
                    flags: V2
                });
            }
        }
        else if (sub === 'delete') {
            await interaction.deferReply({ flags: EPH });
            const id = interaction.options.getString('id', true).trim();
            const giveaway = await supabase.getGiveaway(id);

            if (giveaway) {
                await supabase.deleteGiveaway(id);
                const channel = interaction.guild?.channels.cache.get(giveaway.channel_id);
                if (channel && 'messages' in channel) {
                    const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                    if (message) await message.delete().catch(() => {});
                }
            }

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Deleted', `Giveaway **\`${id}\`** has been deleted from database and channel.`)],
                flags: V2
            });
        }
    },

    async handleButton(interaction) {
        const key = getSessionKey(interaction.user.id, interaction.guildId!);
        const session = wizardSessions.get(key);

        if (interaction.customId.startsWith('giveaway_wiz:')) {
            if (!session) {
                await interaction.reply({ content: '❌ Wizard session expired.', flags: EPH });
                return;
            }

            const action = interaction.customId.split(':')[1];

            if (action === 'cancel') {
                wizardSessions.delete(key);
                await interaction.update({
                    components: [ComponentsV2.warningContainer('Cancelled', 'Giveaway builder wizard session cancelled.')]
                });
                return;
            }

            if (action === 'prev') {
                session.page = Math.max(1, session.page - 1);
                await interaction.update({ components: [renderGiveawayWizard(session)] });
            } 
            else if (action === 'next') {
                session.page = Math.min(3, session.page + 1);
                await interaction.update({ components: [renderGiveawayWizard(session)] });
            }
            else if (action === 'modal') {
                const target = interaction.customId.split(':')[2];
                if (target === 'basic') {
                    const modal = new ModalBuilder().setCustomId('giveaway_wiz_modal:basic').setTitle('Page 1: Basic specifications');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('Prize Item').setPlaceholder('Steam Key / Nitro').setValue(session.prize).setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (e.g. 10m, 1h, 2d)').setPlaceholder('1h').setValue(session.durationText).setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('winners').setLabel('Winners Slots Count').setPlaceholder('1').setValue(String(session.winnersCount)).setStyle(TextInputStyle.Short).setRequired(true))
                    );
                    await interaction.showModal(modal);
                } 
                else if (target === 'reqs') {
                    const modal = new ModalBuilder().setCustomId('giveaway_wiz_modal:reqs').setTitle('Page 2: Participation Filters');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('roleId').setLabel('Required Role ID (Optional)').setPlaceholder('827364857293847582').setValue(session.reqRoleId).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('level').setLabel('Minimum Level Required').setPlaceholder('5').setValue(String(session.reqLevel)).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('invites').setLabel('Minimum Invite Count Required').setPlaceholder('3').setValue(String(session.reqInvites)).setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('booster').setLabel('Require Server Booster (true/false)').setPlaceholder('false').setValue(String(session.reqBooster)).setStyle(TextInputStyle.Short).setRequired(false))
                    );
                    await interaction.showModal(modal);
                }
            }
            else if (action === 'launch') {
                const modal = new ModalBuilder().setCustomId('giveaway_wiz_modal:launch_channel').setTitle('Page 3: Launch Target Channel');
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('channelNameOrId').setLabel('Target Channel Name / ID').setPlaceholder('giveaways').setStyle(TextInputStyle.Short).setRequired(true))
                );
                await interaction.showModal(modal);
            }
        }
        else if (interaction.customId.startsWith('giveaway:enter:')) {
            const giveawayId = interaction.customId.split(':')[2];
            const giveaway = await supabase.getGiveaway(giveawayId);
            if (!giveaway || giveaway.status === 'ended') {
                await interaction.reply({ content: '❌ This giveaway has ended.', flags: EPH });
                return;
            }
            if (giveaway.status === 'paused') {
                await interaction.reply({ content: '⏸️ This giveaway is currently paused.', flags: EPH });
                return;
            }

            const participants = giveaway.participants || [];
            if (participants.includes(interaction.user.id)) {
                await interaction.reply({ content: '🙋 You have already entered this giveaway!', flags: EPH });
                return;
            }

            const member = interaction.member as GuildMember | null;
            if (!member) return;

            // 1. Role requirements
            const rId = giveaway.requirements?.roles?.[0];
            if (rId) {
                const hasRole = member.roles.cache.has(rId);
                if (!hasRole) {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Entry Blocked', `You do not have the required role: <@&${rId}>.`)],
                        flags: V2 | EPH
                    });
                    return;
                }
            }

            // 2. Level requirement
            const lvl = giveaway.requirements?.level ?? 0;
            if (lvl > 0) {
                const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
                let level = 0;
                if (linked) {
                    const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                    if (profile) {
                        level = calculateLevel(Number(profile.total_xp ?? 0));
                    }
                }

                if (level < lvl) {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Entry Blocked', `Your Level is too low. Required: **Level ${lvl}** (You: **Level ${level}**). Link account and check levels via \`/account\`.`)],
                        flags: V2 | EPH
                    });
                    return;
                }
            }

            // 3. Invites requirement
            const invs = giveaway.requirements?.invites ?? 0;
            if (invs > 0) {
                const invitesList = await interaction.guild?.invites.fetch().catch(() => null);
                const userInvites = invitesList ? invitesList.filter(i => i.inviter?.id === interaction.user.id) : null;
                const uses = userInvites ? userInvites.reduce((sum, i) => sum + (i.uses || 0), 0) : 0;

                if (uses < invs) {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Entry Blocked', `You do not have enough invites. Required: **\`${invs}\`** (You: **\`${uses}\`**).`)],
                        flags: V2 | EPH
                    });
                    return;
                }
            }

            // 4. Server booster requirement
            const bst = giveaway.requirements?.booster ?? false;
            if (bst) {
                const isBooster = member.premiumSince !== null;
                if (!isBooster) {
                    await interaction.reply({
                        components: [ComponentsV2.errorContainer('Entry Blocked', 'This giveaway is restricted to server boosters only.')],
                        flags: V2 | EPH
                    });
                    return;
                }
            }

            // Save participant
            const updatedParticipants = [...participants, interaction.user.id];
            await supabase.updateGiveaway(giveawayId, { participants: updatedParticipants });
            
            // Refresh card message
            const card = buildGiveawayCard(giveaway, updatedParticipants.length);
            const channel = interaction.guild?.channels.cache.get(giveaway.channel_id);
            if (channel && 'messages' in channel) {
                const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                if (message) await message.edit({ components: [card], flags: V2 }).catch(() => {});
            }

            await interaction.reply({ content: '🎉 You have successfully entered the giveaway! Good luck!', flags: EPH });
        }
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith('giveaway_wiz_modal:')) return;

        const key = getSessionKey(interaction.user.id, interaction.guildId!);
        const session = wizardSessions.get(key);

        if (!session) {
            await interaction.reply({ content: '❌ Session expired.', flags: EPH });
            return;
        }

        const modalType = interaction.customId.split(':')[1];

        if (modalType === 'basic') {
            session.prize = interaction.fields.getTextInputValue('prize').trim();
            session.durationText = interaction.fields.getTextInputValue('duration').trim();
            session.durationMs = parseDuration(session.durationText);
            
            const wCount = parseInt(interaction.fields.getTextInputValue('winners').trim(), 10);
            session.winnersCount = isNaN(wCount) ? 1 : Math.max(1, wCount);

            await (interaction as any).update({ components: [renderGiveawayWizard(session)] });
        }
        else if (modalType === 'reqs') {
            session.reqRoleId = interaction.fields.getTextInputValue('roleId').trim();
            
            const lvl = parseInt(interaction.fields.getTextInputValue('level').trim(), 10);
            session.reqLevel = isNaN(lvl) ? 0 : Math.max(0, lvl);

            const invs = parseInt(interaction.fields.getTextInputValue('invites').trim(), 10);
            session.reqInvites = isNaN(invs) ? 0 : Math.max(0, invs);

            const bst = interaction.fields.getTextInputValue('booster').trim().toLowerCase();
            session.reqBooster = bst === 'true' || bst === 'yes' || bst === '1';

            await (interaction as any).update({ components: [renderGiveawayWizard(session)] });
        }
        else if (modalType === 'launch_channel') {
            const input = interaction.fields.getTextInputValue('channelNameOrId').trim();
            const channel = interaction.guild?.channels.cache.get(input) || 
                interaction.guild?.channels.cache.find(c => c.name.toLowerCase() === input.toLowerCase() && c.type === ChannelType.GuildText);

            if (!channel || channel.type !== ChannelType.GuildText) {
                await interaction.reply({ content: `❌ Target text channel "${input}" not found.`, flags: EPH });
                return;
            }

            const endsAt = new Date(Date.now() + session.durationMs).toISOString();

            try {
                const tempGiveaway: Giveaway = {
                    id: 'temp',
                    guild_id: interaction.guildId!,
                    channel_id: channel.id,
                    message_id: 'temp',
                    prize: session.prize,
                    duration: session.durationText,
                    winners_count: session.winnersCount,
                    ends_at: endsAt,
                    host_id: interaction.user.id,
                    status: 'active',
                    paused_at: null,
                    paused_remaining: null,
                    requirements: {
                        roles: session.reqRoleId ? [session.reqRoleId] : [],
                        level: session.reqLevel,
                        invites: session.reqInvites,
                        booster: session.reqBooster
                    },
                    bonus_entries: [],
                    participants: [],
                    winners: [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const card = buildGiveawayCard(tempGiveaway, 0);
                const message = await (channel as any).send({
                    components: [card],
                    flags: V2
                });

                tempGiveaway.message_id = message.id;

                const dbGiveaway = await supabase.createGiveaway(
                    interaction.guildId!,
                    channel.id,
                    message.id,
                    session.prize,
                    session.durationText,
                    session.winnersCount,
                    new Date(endsAt),
                    interaction.user.id,
                    tempGiveaway.requirements,
                    []
                );

                if (!dbGiveaway) {
                    await interaction.reply({ content: '❌ System error writing giveaway to database.', flags: EPH });
                    return;
                }

                // Rewrite message with correct ID card
                const actualCard = buildGiveawayCard(dbGiveaway, 0);
                await message.edit({
                    components: [actualCard],
                    flags: V2
                });

                wizardSessions.delete(key);

                await (interaction as any).update({
                    components: [ComponentsV2.successContainer('Giveaway Launched', `Giveaway has been launched in <#${channel.id}>!`)],
                });
            } catch (err) {
                logger.error('Failed to launch giveaway:', err);
                await interaction.reply({ content: '❌ Failed to launch giveaway. Check logs.', flags: EPH });
            }
        }
    }
};

async function endGiveaway(client: Client, giveaway: Giveaway): Promise<void> {
    const participants = giveaway.participants || [];
    const picked: string[] = [];

    if (participants.length > 0) {
        const ids = [...participants];
        for (let i = 0; i < Math.min(giveaway.winners_count, ids.length); i++) {
            const index = Math.floor(Math.random() * ids.length);
            picked.push(ids.splice(index, 1)[0]);
        }
    }

    await supabase.updateGiveaway(giveaway.id, { status: 'ended', winners: picked });

    const guild = client.guilds.cache.get(giveaway.guild_id) || await client.guilds.fetch(giveaway.guild_id).catch(() => null);
    if (!guild) return;

    const channel = guild.channels.cache.get(giveaway.channel_id) || await guild.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const updated = await supabase.getGiveaway(giveaway.id);
    if (updated) {
        const card = buildGiveawayCard(updated, updated.participants.length);
        const message = await (channel as any).messages.fetch(giveaway.message_id).catch(() => null);
        if (message) await message.edit({ components: [card], flags: V2 }).catch(() => {});
    }

    if (picked.length > 0) {
        const winContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.purple)
            .addTextDisplayComponents(ComponentsV2.text(
                `-# 🎁 GIVEAWAY CONCLUDED • #${giveaway.id.slice(0, 8)}\n` +
                `# Congratulations! 🏆\n\n` +
                `The lottery for **"${giveaway.prize}"** has officially finished!\n\n` +
                `› **Winners:** ${picked.map(w => `<@${w}>`).join(', ')}\n` +
                `› **Hosted by:** <@${giveaway.host_id}>\n` +
                `› **Total Entrants:** \`${participants.length}\` participants\n\n` +
                `Claim your reward by contacting the host or opening a ticket!`
            ))
            .addSeparatorComponents(ComponentsV2.separator());

        await (channel as any).send({
            content: `🏆 **Giveaway Winners:** ${picked.map(w => `<@${w}>`).join(', ')}!`,
            components: [winContainer],
            flags: V2
        });
    } else {
        const noWinContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.danger)
            .addTextDisplayComponents(ComponentsV2.text(
                `-# 🎁 GIVEAWAY CONCLUDED • #${giveaway.id.slice(0, 8)}\n` +
                `# No Winners 🎟️\n\n` +
                `The lottery for **"${giveaway.prize}"** has finished, but there were no participants.\n\n` +
                `› **Hosted by:** <@${giveaway.host_id}>`
            ))
            .addSeparatorComponents(ComponentsV2.separator());

        await (channel as any).send({
            components: [noWinContainer],
            flags: V2
        });
    }
}

export function startGiveawayScheduler(client: Client): void {
    setInterval(async () => {
        try {
            const list = await supabase.client
                .from('giveaways')
                .select('*')
                .eq('status', 'active')
                .lte('ends_at', new Date().toISOString());

            const endedList = list.data as Giveaway[] || [];
            for (const giveaway of endedList) {
                await endGiveaway(client, giveaway).catch(err => {
                    logger.error(`Error processing ending giveaway #${giveaway.id}:`, err);
                });
            }
        } catch (error) {
            logger.error('Giveaways scheduler failed:', error);
        }
    }, 30_000);
}
