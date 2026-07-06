import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { config } from '../config.js';
import { supabase } from '../services/supabase.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const HERO_IMAGE = `${config.branding.website}/images/discord-bot-manager-banner.png`;
const INVITE_URL = `https://discord.com/api/oauth2/authorize?client_id=${config.discord.clientId}&permissions=8&scope=bot%20applications.commands`;

// Category artworks (premium dashboard banners)
const CATEGORY_ARTWORK: Record<string, string> = {
    main: HERO_IMAGE,
    administration: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80', // Sleek violet abstract
    moderation: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&q=80', // Dark tech security
    music: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&q=80', // Music concert lights
    utility: 'https://images.unsplash.com/photo-1618005198143-d518ba84d314?w=800&q=80', // Minimalist clean blue abstract
    fun: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80', // Colorful gaming tech
    economy: 'https://images.unsplash.com/photo-1639754390580-2e7437267698?w=800&q=80', // Golden finance/credits abstract
    giveaways: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&q=80', // Celebration sparkle/lights
    tickets: 'https://images.unsplash.com/photo-1557200134-90327ee9fafa?w=800&q=80', // Premium support center
    logging: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&q=80', // Matrix green cyber trace
    developer: 'https://images.unsplash.com/photo-1607799279861-4dd421887fb3?w=800&q=80', // Tech dev code view
};

function getSelectMenu(currentVal?: string) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Explore command categories...')
        .addOptions([
            { label: 'Overview', description: 'Main landing page & information', value: 'main' },
            { label: 'Administration', description: 'Bot configuration, role links & prefixes', value: 'administration' },
            { label: 'Moderation', description: 'Audit logs & suggestion moderations', value: 'moderation' },
            { label: 'Music System', description: 'Compact player & audio controls', value: 'music' },
            { label: 'Utility', description: 'AI assistant, general prefix utilities', value: 'utility' },
            { label: 'Fun', description: 'Entertainment & engagement', value: 'fun' },
            { label: 'Economy', description: 'Coins ledger, bank, converts & rankings', value: 'economy' },
            { label: 'Giveaways', description: 'Premium lottery creation & boosters', value: 'giveaways' },
            { label: 'Tickets System', description: 'Interactive website ticket relays', value: 'tickets' },
            { label: 'Logging', description: 'Server tracking & alerts', value: 'logging' },
            { label: 'Developer', description: 'Debug parameters & system diagnostics', value: 'developer' }
        ]);

    if (currentVal) {
        menu.options.forEach(opt => {
            if (opt.data.value === currentVal) opt.setDefault(true);
        });
    }

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function getButtons() {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Invite Bot')
            .setStyle(ButtonStyle.Link)
            .setURL(INVITE_URL),
        new ButtonBuilder()
            .setLabel('Support Guild')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Vote on Top.gg')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/vote`)
    );
}

export const helpCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Open the premium Victus Cloud interactive help menu')
        .setDMPermission(false),

    cooldown: 3,

    async execute(interaction) {
        await interaction.deferReply({ flags: EPH | V2 });

        const settings = await supabase.getBotSettings(interaction.guildId!).catch(() => null);
        const prefix = settings?.prefix || '!';

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        container.addMediaGalleryComponents(ComponentsV2.mediaGallery(CATEGORY_ARTWORK.main));

        const body = `-# 💫 VICTUS CLOUD CONNECTION • COMMAND LAYER\n` +
            `# Victus Cloud Support Hub\n\n` +
            `Welcome, **${interaction.user.username}**. Synced with the main console, this panel grants access to all operational commands.\n\n` +
            `### ⚙️ Quick Connection Details\n` +
            `› **Server Prefix:** \`${prefix}\`\n` +
            `› **Bot Prefix:** \`!\` / Mention prefix (e.g. <@${interaction.client.user?.id}>)\n` +
            `› **Live Services:** Synced with [victuscloud.com](https://victuscloud.com)\n\n` +
            `Use the dropdown menu below to inspect specific modules.`;

        container.addTextDisplayComponents(ComponentsV2.text(body))
            .addSeparatorComponents(ComponentsV2.separator())
            .addActionRowComponents(getButtons())
            .addActionRowComponents(getSelectMenu('main'))
            .addTextDisplayComponents(ComponentsV2.text(`-# Private session • Victus Cloud v${config.bot.linkTokenExpiryMinutes ? '1.4' : '1.0'}`));

        await interaction.editReply({
            components: [container],
            flags: V2,
        });
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'help_category') return;

        const category = interaction.values[0] || 'main';
        const settings = await supabase.getBotSettings(interaction.guildId!).catch(() => null);
        const prefix = settings?.prefix || '!';

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        
        // Render corresponding category artwork
        const artwork = CATEGORY_ARTWORK[category] || CATEGORY_ARTWORK.main;
        container.addMediaGalleryComponents(ComponentsV2.mediaGallery(artwork));

        let title = '';
        let desc = '';

        switch (category) {
            case 'main':
                title = 'Victus Cloud Support Hub';
                desc = `Welcome, **${interaction.user.username}**. Synced with the main console, this panel grants access to all operational commands.\n\n` +
                    `### ⚙️ Quick Connection Details\n` +
                    `› **Server Prefix:** \`${prefix}\`\n` +
                    `› **Bot Prefix:** \`!\` / Mention prefix\n` +
                    `› **Live Services:** Synced with [victuscloud.com](https://victuscloud.com)\n\n` +
                    `Use the dropdown menu below to inspect specific modules.`;
                break;

            case 'administration':
                title = 'Administration Panel';
                desc = `Commands to customize your server layout, bind database profiles, and set roles.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/config\` • Configure log channels, role locks, and tickets.\n` +
                    `› \`/annc\` • Configure and send announcements (Admin only).\n` +
                    `› \`/link-panel\` • Spawns a premium account verification button.\n` +
                    `› \`/setprefix <prefix>\` • Changes the server-specific prefix.\n` +
                    `› \`/prefix\` • Inspect current server prefix.\n\n` +
                    `_Requires **Manage Server** or Administrator permissions._`;
                break;

            case 'moderation':
                title = 'Moderation Suite';
                desc = `Keep your server secure and track suggestions/tickets.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/kick <user> [reason]\` • Kick a user from the guild.\n` +
                    `› \`/ban <user> [reason]\` • Permanently ban a user.\n` +
                    `› \`/unban <user_id> [reason]\` • Lift a server ban.\n` +
                    `› \`/timeout <user> <duration> [reason]\` • Place a user in timeout (mute).\n` +
                    `› \`/untimeout <user> [reason]\` • Remove a user's timeout.\n` +
                    `› \`/purge <count> [user]\` • Bulk-delete channel messages.\n` +
                    `› \`/whitelist <add/remove/list/edit>\` • Manage user immunities.\n` +
                    `› \`/ticket close\` • Terminate support thread.\n` +
                    `› \`/ticket claim\` • Allocate ticket to active staff.\n` +
                    `› \`/suggest modapprove <id>\` • Instantly implement suggestions.\n` +
                    `› \`/suggest moddeny <id>\` • Deny suggestions.\n\n` +
                    `_All moderator actions log directly to your configured Discord log channel._`;
                break;

            case 'music':
                title = 'Premium Music Card Player';
                desc = `Listen to high-fidelity audio directly inside Stage/Voice channels.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/music\` • Open the interactive Now Playing & controls panel.\n` +
                    `› \`/play <query/URL>\` • Starts a track from YouTube, SoundCloud, or direct URLs.\n` +
                    `› \`/playrandom\` • Play a curated random track by category and language.\n` +
                    `› \`/nowplaying\` • Spawns the compact Bloom music player.\n` +
                    `› \`/skip\` • Skip current song.\n` +
                    `› \`/stop\` • Halt audio, clear queue, and disconnect.\n` +
                    `› \`/volume <level>\` • Adjust volume (0-150%).\n` +
                    `› \`/loop <off/track/queue>\` • Repeat current tracks.\n` +
                    `› \`/shuffle\` • Shuffle queue.\n` +
                    `› \`/queue\` • List upcoming tracks.`;
                break;

            case 'utility':
                title = 'Utility Layer';
                desc = `Core utilities and account support interfaces.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/ask <question>\` • Consult Groq-powered AI for server management.\n` +
                    `› \`/afk [reason]\` • Set your status to AFK.\n` +
                    `› \`/poll create\` • Launch a server-wide interactive poll.\n` +
                    `› \`/reactroles setup\` • Create self-assignable role panels.\n` +
                    `› \`/serverstats setup\` • Auto-update voice channels showing server statistics.\n` +
                    `› \`/vpsstats\` • View host resource usage of the Victus Cloud VPS.\n` +
                    `› \`/welcome setup\` • Configure welcome system and join auto-roles.\n` +
                    `› \`/link <token>\` • Connect Discord with your website account.\n` +
                    `› \`/unlink\` • Disconnect linked profile.\n` +
                    `› \`/help\` • Toggle this support dashboard.`;
                break;

            case 'fun':
                title = 'Engagement Hub';
                desc = `Keep your guild members engaged with fun utilities.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/ask question:"tell me a joke"\` • Generates interactive AI humor.\n` +
                    `› \`/economy Convert\` • Convert currency inside fun mini-games.\n\n` +
                    `_Member XP awards are updated dynamically during chat and active voice time._`;
                break;

            case 'economy':
                title = 'Victus Economy & Wallet';
                desc = `Manage Coins, credit sync, bank ledgers, and rankings.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/account\` • Main dashboard displaying Coins, level, and billing credits.\n` +
                    `› \`/economy\` • Open interactive bank, transfer, and convert panel.\n` +
                    `› \`/economy conversion\` • Swap between Coins and billing Credits.\n\n` +
                    `_Wallet and ledger are fully synchronized with paymenter / main dashboard._`;
                break;

            case 'giveaways':
                title = 'Premium Giveaway System';
                desc = `Launch luxury giveaways with level, booster, or role requirements.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/giveaway create\` • Open Components V2 creation wizard.\n` +
                    `› \`/giveaway end <id>\` • Halt a lottery and select winners immediately.\n` +
                    `› \`/giveaway pause <id>\` • Pause ends_at timer.\n` +
                    `› \`/giveaway resume <id>\` • Resume ends_at timer.\n` +
                    `› \`/giveaway reroll <id>\` • Pick new winners for an ended lottery.\n` +
                    `› \`/giveaway list\` • Inspect all active giveaways.`;
                break;

            case 'tickets':
                title = 'Interactive Ticket Bridge';
                desc = `Website-to-Discord real-time ticket relay system.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/ticket create\` • Opens a ticket form modal.\n` +
                    `› \`/ticket add <user>\` • Add user to support channel.\n` +
                    `› \`/ticket remove <user>\` • Remove user from channel.\n` +
                    `› \`/summon\` • Invite AI assistant directly into a support channel.`;
                break;

            case 'logging':
                title = 'Alert Log Channels';
                desc = `Keep track of server logs, user actions, and audit logs.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/audit-log setup\` • Configure logging for edits, deletes, joins, and bans.\n` +
                    `› \`/config logs <channel>\` • Set target discord channel for logs.\n` +
                    `› \`/embed settings\` • Toggle logging for custom publish templates.`;
                break;

            case 'developer':
                title = 'Developer Console';
                desc = `Bot administration and status hooks.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/admin stats\` • Get host resources, latency, and uptime.\n` +
                    `› \`/admin reload\` • Hot-reload commands.\n\n` +
                    `_Restricted to verified bot administrators (defined in database settings)._`;
                break;
        }

        const body = `-# 💠 VICTUS CLOUD CONNECTION • ${category.toUpperCase()}\n` +
            `# ${title}\n\n` +
            `${desc}`;

        container.addTextDisplayComponents(ComponentsV2.text(body))
            .addSeparatorComponents(ComponentsV2.separator())
            .addActionRowComponents(getButtons())
            .addActionRowComponents(getSelectMenu(category))
            .addTextDisplayComponents(ComponentsV2.text(`-# Server Prefix: ${prefix} • Active Session`));

        await interaction.update({
            components: [container],
            embeds: [],
            flags: V2,
        });
    },
};
