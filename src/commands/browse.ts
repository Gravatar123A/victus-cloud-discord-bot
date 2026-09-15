import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    ButtonInteraction,
    StringSelectMenuInteraction,
    ModalSubmitInteraction,
} from 'discord.js';
import crypto from 'node:crypto';
import type { Command } from '../types/index.js';
import { discoveryService, KNOWN_CATEGORIES } from '../services/discoveryService.js';
import { DiscoveryEmbeds, BrowserSessionState } from '../embeds/discoveryEmbeds.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

// Session cache (15 minutes TTL)
const sessions = new Map<string, BrowserSessionState & { expiresAt: number }>();

function cleanupSessions() {
    const now = Date.now();
    for (const [token, s] of sessions.entries()) {
        if (s.expiresAt < now) sessions.delete(token);
    }
}
setInterval(cleanupSessions, 5 * 60 * 1000);

export function createBrowserSession(userId: string, initial: Partial<BrowserSessionState> = {}): BrowserSessionState {
    const token = crypto.randomBytes(8).toString('hex');
    const state: BrowserSessionState & { expiresAt: number } = {
        token,
        userId,
        page: initial.page || 1,
        search: initial.search,
        category: initial.category,
        sort: initial.sort || 'rating_desc',
        status: initial.status || 'all',
        tier: initial.tier || 'all',
        expiresAt: Date.now() + 15 * 60 * 1000,
    };
    sessions.set(token, state);
    return state;
}

export function getBrowserSession(token: string): BrowserSessionState | null {
    const s = sessions.get(token);
    if (!s) return null;
    s.expiresAt = Date.now() + 15 * 60 * 1000;
    return s;
}

export const browseCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('browse')
        .setDescription('Interactive server browser for Victus Cloud Minecraft servers')
        .addStringOption((opt) =>
            opt.setName('search').setDescription('Search servers by name, description, or IP')
        )
        .addStringOption((opt) =>
            opt
                .setName('category')
                .setDescription('Filter by gameplay category')
                .setAutocomplete(true)
        )
        .addStringOption((opt) =>
            opt
                .setName('sort')
                .setDescription('Sort results')
                .addChoices(
                    { name: '⭐ Top Rated (Default)', value: 'rating_desc' },
                    { name: '👥 Most Players', value: 'players_desc' },
                    { name: '👤 Least Players', value: 'players_asc' },
                    { name: '⚡ Highest Uptime', value: 'uptime_desc' },
                    { name: '✨ Newest Added', value: 'newest' },
                    { name: '🔤 Alphabetical (A-Z)', value: 'alpha' }
                )
        )
        .addStringOption((opt) =>
            opt
                .setName('status')
                .setDescription('Status filter')
                .addChoices(
                    { name: '🌐 All Statuses', value: 'all' },
                    { name: '🟢 Online Only', value: 'online_only' }
                )
        )
        .addStringOption((opt) =>
            opt
                .setName('tier')
                .setDescription('Hosting tier filter')
                .addChoices(
                    { name: '🌐 All Tiers', value: 'all' },
                    { name: '⚡ Free Tier', value: 'free' },
                    { name: '💎 Paid Cloud', value: 'paid' }
                )
        )
        .addBooleanOption((opt) =>
            opt.setName('ephemeral').setDescription('Make the response visible only to you (default: false)')
        ),

    cooldown: 3,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = Object.entries(KNOWN_CATEGORIES).map(([key, meta]) => ({
            name: `${meta.emoji} ${meta.label}`,
            value: key,
        }));

        const filtered = choices
            .filter((c) => c.name.toLowerCase().includes(focused) || c.value.includes(focused))
            .slice(0, 25);

        await interaction.respond(filtered);
    },

    async execute(interaction) {
        const isEphemeral = interaction.options.getBoolean('ephemeral') ?? false;
        const search = interaction.options.getString('search')?.trim();
        const category = interaction.options.getString('category')?.trim();
        const sort = (interaction.options.getString('sort') as any) || 'rating_desc';
        const status = (interaction.options.getString('status') as any) || 'all';
        const tier = (interaction.options.getString('tier') as any) || 'all';

        const flags = ComponentsV2.IS_COMPONENTS_V2 | (isEphemeral ? MessageFlags.Ephemeral : 0);
        await interaction.deferReply({ flags });

        const session = createBrowserSession(interaction.user.id, {
            search,
            category,
            sort,
            status,
            tier,
            page: 1,
        });

        const data = await discoveryService.getFilteredServers({
            search: session.search,
            category: session.category,
            sort: session.sort,
            status: session.status,
            tier: session.tier,
            page: session.page,
            pageSize: 6,
        });

        const { container, actionRows } = DiscoveryEmbeds.buildBrowser(data, session);

        await interaction.editReply({
            components: [container, ...actionRows],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleButton(interaction: ButtonInteraction) {
        const [prefix, action, token] = interaction.customId.split(/[_:]/);
        if (prefix !== 'browse') return;

        const sessionToken = interaction.customId.split(':')[1];
        const session = getBrowserSession(sessionToken);

        if (!session) {
            await interaction.reply({
                content: '⚠️ This server browser session expired. Run `/browse` or `/servers` to open a new one.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }

        const btnType = interaction.customId.slice(0, interaction.customId.indexOf(':'));

        if (btnType === 'browse_search_btn') {
            const modal = new ModalBuilder()
                .setCustomId(`browse_modal:${sessionToken}`)
                .setTitle('Search Minecraft Servers');

            const input = new TextInputBuilder()
                .setCustomId('search_query')
                .setLabel('Keywords (Name, description, or IP)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. SMP, Lifesteal, play.victus.xyz...')
                .setValue(session.search || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
            await interaction.showModal(modal);
            return;
        }

        if (btnType === 'browse_clear_search') {
            session.search = undefined;
            session.category = undefined;
            session.page = 1;
        } else if (btnType === 'browse_prev') {
            session.page = Math.max(1, session.page - 1);
        } else if (btnType === 'browse_next') {
            session.page += 1;
        }

        const data = await discoveryService.getFilteredServers({
            search: session.search,
            category: session.category,
            sort: session.sort,
            status: session.status,
            tier: session.tier,
            page: session.page,
            pageSize: 6,
        });

        // Ensure page bound
        if (session.page > data.totalPages) session.page = data.totalPages;

        const { container, actionRows } = DiscoveryEmbeds.buildBrowser(data, session);

        await interaction.update({
            components: [container, ...actionRows],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (!interaction.customId.startsWith('browse_')) return;

        const sessionToken = interaction.customId.split(':')[1];
        const session = getBrowserSession(sessionToken);

        if (!session) {
            await interaction.reply({
                content: '⚠️ This server browser session expired. Run `/browse` to open a new one.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }

        const selectedValue = interaction.values[0];

        if (interaction.customId.startsWith('browse_cat:')) {
            session.category = selectedValue === 'all' ? undefined : selectedValue;
            session.page = 1;
        } else if (interaction.customId.startsWith('browse_sort:')) {
            session.sort = selectedValue as any;
            session.page = 1;
        }

        const data = await discoveryService.getFilteredServers({
            search: session.search,
            category: session.category,
            sort: session.sort,
            status: session.status,
            tier: session.tier,
            page: session.page,
            pageSize: 6,
        });

        const { container, actionRows } = DiscoveryEmbeds.buildBrowser(data, session);

        await interaction.update({
            components: [container, ...actionRows],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleModal(interaction: ModalSubmitInteraction) {
        if (!interaction.customId.startsWith('browse_modal:')) return;

        const sessionToken = interaction.customId.split(':')[1];
        const session = getBrowserSession(sessionToken);

        if (!session) {
            await interaction.reply({
                content: '⚠️ This server browser session expired. Run `/browse` to open a new one.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }

        const query = interaction.fields.getTextInputValue('search_query').trim();
        session.search = query.length > 0 ? query : undefined;
        session.page = 1;

        const data = await discoveryService.getFilteredServers({
            search: session.search,
            category: session.category,
            sort: session.sort,
            status: session.status,
            tier: session.tier,
            page: session.page,
            pageSize: 6,
        });

        const { container, actionRows } = DiscoveryEmbeds.buildBrowser(data, session);

        await interaction.deferUpdate();
        await interaction.editReply({
            components: [container, ...actionRows],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
