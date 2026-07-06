import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

interface Poll {
    id: string;
    question: string;
    options: string[];
    votes: Map<string, number>; // userId -> optionIndex
    creatorId: string;
    expiresAt: number | null;
}

const activePolls = new Map<string, Poll>();

function makeResultsProgressBar(votes: number, total: number, size = 10): string {
    if (total === 0) return '░'.repeat(size);
    const filled = Math.round((votes / total) * size);
    const empty = size - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function renderPollContainer(poll: Poll, ended = false): any {
    const totalVotes = poll.votes.size;
    const accent = ended ? ComponentsV2.Accents.warning : ComponentsV2.Accents.primary;
    const container = ComponentsV2.baseContainer(accent);

    let title = ended ? `📊 Poll Ended: ${poll.question}` : `📊 Poll: ${poll.question}`;
    let desc = '';

    if (ended) {
        // Calculate results
        const optVotes = new Array(poll.options.length).fill(0);
        poll.votes.forEach((optIdx) => {
            if (optIdx >= 0 && optIdx < optVotes.length) {
                optVotes[optIdx]++;
            }
        });

        desc = `# ${poll.question}\n\n`;
        poll.options.forEach((opt, idx) => {
            const count = optVotes[idx];
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            desc += `**Option ${idx + 1}:** ${opt}\n`;
            desc += `\`${makeResultsProgressBar(count, totalVotes)}\` **${count}** votes (${pct}%)\n\n`;
        });

        desc += `*Total votes: **${totalVotes}***`;
    } else {
        desc = `# ${poll.question}\n\n`;
        poll.options.forEach((opt, idx) => {
            desc += `**Option ${idx + 1}:** ${opt}\n`;
        });
        
        if (poll.expiresAt) {
            desc += `\n*Ends <t:${Math.floor(poll.expiresAt / 1000)}:R>*`;
        }
        desc += `\n\n*Select your choice in the menu below to vote. Total votes: **${totalVotes}***`;
    }

    container.addTextDisplayComponents(ComponentsV2.text(desc));

    if (!ended) {
        container.addSeparatorComponents(ComponentsV2.separator());
        
        const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`poll:vote:${poll.id}`)
                .setPlaceholder('Cast your vote...')
                .addOptions(poll.options.map((opt, idx) => ({
                    label: `${idx + 1}. ${opt.slice(0, 80)}`,
                    value: String(idx)
                })))
        );
        container.addActionRowComponents(menu);

        // Creator control buttons
        const endRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`poll:end:${poll.id}`)
                .setLabel('End Poll 🛑')
                .setStyle(ButtonStyle.Danger)
        );
        container.addActionRowComponents(endRow);
    }

    return container;
}

export const pollCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create and manage server polls')
        .setDMPermission(false)
        .addSubcommand(sub => 
            sub.setName('create')
                .setDescription('Launch a new poll wizard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        if (sub === 'create') {
            const isPrefix = interaction.constructor.name === 'PrefixInteraction';
            if (isPrefix) {
                await interaction.reply({ content: '❌ Poll creation is only supported via slash commands due to modal requirements.' });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('poll_wiz_modal')
                .setTitle('Create a New Poll');

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('question')
                        .setLabel('Poll Question/Topic')
                        .setPlaceholder('What is your favorite game?')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('options')
                        .setLabel('Options (one per line, 2-10)')
                        .setPlaceholder('Minecraft\nGTA V\nValorant')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('duration')
                        .setLabel('Duration (e.g. 30m, 2h, 1d) or 0 for unlimited')
                        .setPlaceholder('1h')
                        .setValue('0')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                )
            );

            await interaction.showModal(modal);
        }
    },

    async handleModal(interaction) {
        if (interaction.customId !== 'poll_wiz_modal') return;

        const question = interaction.fields.getTextInputValue('question').trim();
        const optionsRaw = interaction.fields.getTextInputValue('options');
        const durationStr = interaction.fields.getTextInputValue('duration').trim();

        const options = optionsRaw.split('\n')
            .map(opt => opt.trim())
            .filter(opt => opt.length > 0);

        if (options.length < 2 || options.length > 10) {
            await interaction.reply({
                content: '❌ You must provide between 2 and 10 options.',
                flags: EPH
            });
            return;
        }

        let expiresAt: number | null = null;
        if (durationStr && durationStr !== '0') {
            const match = durationStr.toLowerCase().match(/^(\d+)(m|h|d)$/);
            if (match) {
                const value = parseInt(match[1], 10);
                const unit = match[2];
                let ms = 0;
                if (unit === 'm') ms = value * 60 * 1000;
                else if (unit === 'h') ms = value * 60 * 60 * 1000;
                else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;
                expiresAt = Date.now() + ms;
            }
        }

        const pollId = Math.random().toString(36).substring(2, 10);
        const poll: Poll = {
            id: pollId,
            question,
            options,
            votes: new Map(),
            creatorId: interaction.user.id,
            expiresAt
        };

        activePolls.set(pollId, poll);

        // Defer & Send public response
        await interaction.reply({
            components: [renderPollContainer(poll)],
            flags: V2
        });

        // Set timeout if duration provided
        if (expiresAt) {
            const timeUntilExpiry = expiresAt - Date.now();
            if (timeUntilExpiry > 0) {
                setTimeout(async () => {
                    const latestPoll = activePolls.get(pollId);
                    if (latestPoll) {
                        try {
                            const originalMessage = await interaction.fetchReply();
                            await originalMessage.edit({
                                components: [renderPollContainer(latestPoll, true)]
                            });
                            activePolls.delete(pollId);
                        } catch (err) {
                            logger.error('Failed to auto-end poll:', err);
                        }
                    }
                }, timeUntilExpiry);
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('poll:vote:')) return;
        const pollId = interaction.customId.split(':')[2];
        const poll = activePolls.get(pollId);

        if (!poll) {
            await interaction.reply({ content: '❌ Poll not found or has already ended.', flags: EPH });
            return;
        }

        const value = parseInt(interaction.values[0], 10);
        poll.votes.set(interaction.user.id, value);

        await interaction.deferUpdate();
        await interaction.editReply({
            components: [renderPollContainer(poll)],
            embeds: [],
            flags: V2
        });
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('poll:end:')) return;
        const pollId = interaction.customId.split(':')[2];
        const poll = activePolls.get(pollId);

        if (!poll) {
            await interaction.reply({ content: '❌ Poll not found or has already ended.', flags: EPH });
            return;
        }

        // Perm Check
        const isCreator = poll.creatorId === interaction.user.id;
        const hasManageServer = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

        if (!isCreator && !hasManageServer) {
            await interaction.reply({
                content: '❌ Only the poll creator or server administrators can end this poll.',
                flags: EPH
            });
            return;
        }

        await interaction.deferUpdate();
        await interaction.editReply({
            components: [renderPollContainer(poll, true)],
            embeds: [],
            flags: V2
        });

        activePolls.delete(pollId);
    }
};
