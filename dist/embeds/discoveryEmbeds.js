import { ContainerBuilder, SectionBuilder, ThumbnailBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, } from 'discord.js';
import { KNOWN_CATEGORIES } from '../services/discoveryService.js';
import { config } from '../config.js';
export class DiscoveryEmbeds {
    /**
     * Get status dot and label
     */
    static getStatusBadge(status) {
        switch (status) {
            case 'online':
                return { dot: '🟢', label: 'ONLINE' };
            case 'starting':
                return { dot: '🟡', label: 'STARTING' };
            case 'crashed':
                return { dot: '⚠️', label: 'CRASHED' };
            case 'offline':
            default:
                return { dot: '🔴', label: 'OFFLINE' };
        }
    }
    /**
     * Build the Server Discovery Browser UI (Discord Components V2)
     */
    static buildBrowser(data, state) {
        const container = new ContainerBuilder();
        container.setAccentColor(config.branding.color);
        // Header Text Display
        const headerLines = [
            `# 🌐 Victus Cloud — Server Browser`,
            `- **Directory:** Explore ${data.totalItems} active community Minecraft servers`,
            `> 🏷️ **Category:** \`${state.category || 'All Categories'}\` • 📶 **Sort:** \`${state.sort || 'Most Players'}\`${state.search ? ` • 🔎 **Search:** \`${state.search}\`` : ''}`,
        ];
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        if (data.items.length === 0) {
            const emptySection = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 🔍 No Servers Found\n` +
                `No public servers matched your active filters.\n\n` +
                `• Try clearing your search keyword\n` +
                `• Select **All Categories** from the dropdown\n` +
                `• Switch status to show offline servers`));
            container.addSectionComponents(emptySection);
        }
        else {
            for (const server of data.items) {
                const statusMeta = this.getStatusBadge(server.status);
                const desc = server.description
                    ? server.description.length > 95
                        ? `${server.description.slice(0, 92)}...`
                        : server.description
                    : 'Victus Cloud hosted community Minecraft node.';
                const iconUrl = server.icon
                    ? (server.icon.startsWith('http') ? server.icon : `https://mcasset.cloud/1.21.4/assets/minecraft/textures/item/${server.icon.toLowerCase()}.png`)
                    : (KNOWN_CATEGORIES[server.category]?.icon || KNOWN_CATEGORIES.other.icon);
                const tierBadge = server.planTier === 'paid' ? '💎 Premium' : '⚡ Free';
                const featuredBadge = server.featured ? '⭐ Featured • ' : '';
                const ratingBadge = server.ratingCount > 0 ? ` • ⭐ \`${server.ratingAvg.toFixed(1)}\` (${server.ratingCount})` : '';
                const content = `**${statusMeta.dot} ${server.serverName}**\n` +
                    `-# ${featuredBadge}👥 \`${server.currentPlayerCount}/${server.maxPlayers}\` • 🏷️ ${server.categoryLabel} • ${tierBadge} • ⚡ \`${server.uptimePercent.last7d}%\`${ratingBadge}\n` +
                    `${desc}\n` +
                    `-# 🔗 \`${server.ip}\``;
                const section = new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
                container.addSectionComponents(section);
            }
        }
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        // Footer telemetry text
        const footerText = `-# Showing servers ${data.totalItems > 0 ? (data.page - 1) * data.pageSize + 1 : 0}–${Math.min(data.page * data.pageSize, data.totalItems)} of ${data.totalItems} • Page ${data.page}/${data.totalPages} • Updated <t:${Math.floor(Date.now() / 1000)}:R>`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText));
        // Interactive Action Rows
        const actionRows = [];
        // 1. Category Filter Select Menu
        const categorySelect = new StringSelectMenuBuilder()
            .setCustomId(`browse_cat:${state.token}`)
            .setPlaceholder('Filter by Category...')
            .addOptions(new StringSelectMenuOptionBuilder()
            .setLabel('All Categories')
            .setValue('all')
            .setDescription('Show servers from every gameplay category')
            .setEmoji('🌐')
            .setDefault(!state.category || state.category === 'all'));
        for (const [key, meta] of Object.entries(KNOWN_CATEGORIES)) {
            categorySelect.addOptions(new StringSelectMenuOptionBuilder()
                .setLabel(meta.label)
                .setValue(key)
                .setDescription(`Browse ${meta.label} servers`)
                .setEmoji(meta.emoji)
                .setDefault(state.category === key));
        }
        actionRows.push(new ActionRowBuilder().addComponents(categorySelect));
        // 2. Sort Select Menu
        const sortSelect = new StringSelectMenuBuilder()
            .setCustomId(`browse_sort:${state.token}`)
            .setPlaceholder('Sort servers by...')
            .addOptions(new StringSelectMenuOptionBuilder()
            .setLabel('Top Rated (Default)')
            .setValue('rating_desc')
            .setDescription('Highest rated community servers with online priority')
            .setEmoji('⭐')
            .setDefault(!state.sort || state.sort === 'rating_desc'), new StringSelectMenuOptionBuilder()
            .setLabel('Most Players')
            .setValue('players_desc')
            .setDescription('Servers with highest online player count first')
            .setEmoji('👥')
            .setDefault(state.sort === 'players_desc'), new StringSelectMenuOptionBuilder()
            .setLabel('Least Players')
            .setValue('players_asc')
            .setDescription('Servers with lower online player counts')
            .setEmoji('👤')
            .setDefault(state.sort === 'players_asc'), new StringSelectMenuOptionBuilder()
            .setLabel('Highest Uptime')
            .setValue('uptime_desc')
            .setDescription('Most stable nodes based on 7-day uptime')
            .setEmoji('⚡')
            .setDefault(state.sort === 'uptime_desc'), new StringSelectMenuOptionBuilder()
            .setLabel('Newest Added')
            .setValue('newest')
            .setDescription('Recently provisioned and discovered servers')
            .setEmoji('✨')
            .setDefault(state.sort === 'newest'), new StringSelectMenuOptionBuilder()
            .setLabel('Alphabetical (A-Z)')
            .setValue('alpha')
            .setDescription('Sort server list alphabetically')
            .setEmoji('🔤')
            .setDefault(state.sort === 'alpha'));
        actionRows.push(new ActionRowBuilder().addComponents(sortSelect));
        // 3. Navigation Buttons Row
        const prevBtn = new ButtonBuilder()
            .setCustomId(`browse_prev:${state.token}`)
            .setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(data.page <= 1);
        const pageIndicatorBtn = new ButtonBuilder()
            .setCustomId(`browse_counter:${state.token}`)
            .setLabel(`${data.page} / ${data.totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
        const nextBtn = new ButtonBuilder()
            .setCustomId(`browse_next:${state.token}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(data.page >= data.totalPages);
        const searchBtn = new ButtonBuilder()
            .setCustomId(`browse_search_btn:${state.token}`)
            .setLabel(state.search ? `🔎 "${state.search.slice(0, 10)}..."` : '🔎 Search')
            .setStyle(state.search ? ButtonStyle.Primary : ButtonStyle.Secondary);
        const clearSearchBtn = new ButtonBuilder()
            .setCustomId(`browse_clear_search:${state.token}`)
            .setLabel('✕ Clear')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!state.search && (!state.category || state.category === 'all'));
        actionRows.push(new ActionRowBuilder().addComponents(prevBtn, pageIndicatorBtn, nextBtn, searchBtn, clearSearchBtn));
        return { container, actionRows };
    }
    /**
     * Build single server detailed status card (Discord Components V2)
     * Used for /status <server> and live forum directory starter posts.
     */
    static buildServerStatusCard(server) {
        const container = new ContainerBuilder();
        const statusMeta = this.getStatusBadge(server.status);
        const accent = server.status === 'online' ? 0x22c55e : server.status === 'starting' ? 0xeab308 : 0xef4444;
        container.setAccentColor(accent);
        const iconUrl = server.icon
            ? (server.icon.startsWith('http') ? server.icon : `https://mcasset.cloud/1.21.4/assets/minecraft/textures/item/${server.icon.toLowerCase()}.png`)
            : (KNOWN_CATEGORIES[server.category]?.icon || KNOWN_CATEGORIES.other.icon);
        // Header Section
        const tierLabel = server.planTier === 'paid' ? '💎 Premium Cloud Tier' : '⚡ Free Community Tier';
        const featuredText = server.featured ? '⭐ **Featured Community Partner**\n' : '';
        const headerContent = `# ${statusMeta.dot} ${server.serverName}\n` +
            `${featuredText}` +
            `› **Category:** \`${server.categoryLabel}\` • **Status:** \`${statusMeta.label}\`\n` +
            `› **Host Architecture:** \`${tierLabel}\``;
        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl));
        container.addSectionComponents(headerSection);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        // Telemetry Metrics Section
        const createdDate = server.createdAt
            ? `<t:${Math.floor(new Date(server.createdAt).getTime() / 1000)}:D> (<t:${Math.floor(new Date(server.createdAt).getTime() / 1000)}:R>)`
            : 'Long-standing community node';
        const ratingText = server.ratingCount > 0
            ? `\`${server.ratingAvg.toFixed(1)} / 5.0\` (${server.ratingCount} ${server.ratingCount === 1 ? 'review' : 'reviews'})`
            : '*Unrated* (Be the first to rate!)';
        let playersLine = `› 👥 **Active Players:** \`${server.currentPlayerCount} / ${server.maxPlayers}\` live`;
        if (server.currentPlayerCount > 0 && server.playerSample && server.playerSample.length > 0) {
            const sampleNames = server.playerSample.slice(0, 5).map((n) => `\`${n}\``).join(', ');
            const extraCount = server.playerSample.length > 5 ? ` +${server.playerSample.length - 5} more` : '';
            playersLine += `\n-# 🎮 Online now: ${sampleNames}${extraCount}`;
        }
        const telemetryText = `### 📊 Live Telemetry & Metrics\n\n` +
            `› ⭐ **Community Rating:** ${ratingText}\n` +
            `${playersLine}\n` +
            `› 📈 **Activity Trends:** \`${server.averagePlayerCount.last24h} avg (24h)\` • \`${server.averagePlayerCount.last7d} avg (7d)\`\n` +
            `› ⚡ **Uptime Reliability:** \`${server.uptimePercent.last7d}%\` (7-day) • \`${server.uptimePercent.last30d}%\` (30-day)\n` +
            `› 📦 **Minecraft Engine:** \`${server.software || 'Paper'} ${server.version || '1.21.4'}\`\n` +
            `› 🗓️ **Operational Since:** ${createdDate}\n` +
            `› 👤 **Server Owner:** ${server.ownerUsername ? `\`${server.ownerUsername}\`` : 'Victus Member'}`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(telemetryText));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        // Description Section
        const descText = server.description && server.description.trim().length > 0
            ? server.description.trim()
            : '*The owner has not provided an extended description for this server yet.*';
        const descriptionBlock = `### 📜 Server Description\n${descText}`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(descriptionBlock));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        // Direct Connect Block
        const connectBlock = `### 🎮 How to Connect\n` +
            `Copy and paste the address below into your Minecraft multiplayer server list:\n\n` +
            `\`\`\`\n${server.ip}\n\`\`\`\n` +
            (server.directAddress && server.directAddress !== server.ip
                ? `-# Direct Node Address: \`${server.directAddress}\`\n`
                : '') +
            `-# Compatible with Java & Bedrock (Geyser enabled) • Powered by Victus Cloud`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(connectBlock));
        // Action Row with Link to Web / Panel Discovery Page
        const webUrl = `https://victuscloud.com/community/servers`;
        const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('View on Victus Web')
            .setURL(webUrl)
            .setStyle(ButtonStyle.Link)
            .setEmoji('🌐'), new ButtonBuilder()
            .setLabel('Open Control Panel')
            .setURL(config.branding.panel)
            .setStyle(ButtonStyle.Link)
            .setEmoji('⚙️'));
        return { container, actionRows: [actionRow] };
    }
}
