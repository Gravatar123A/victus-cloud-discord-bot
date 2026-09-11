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
            { label: 'Viral RPG & Hosting', description: 'Minecraft RPG, Gambling, Bosses & Utilities', value: 'viral_rpg' },
            { label: 'Administration', description: 'Bot configuration, role links & prefixes', value: 'administration' },
            { label: 'Moderation', description: 'Audit logs & suggestion moderations', value: 'moderation' },
            { label: 'Music System', description: 'Compact player & audio controls', value: 'music' },
            { label: 'Utility', description: 'AI assistant, general prefix utilities', value: 'utility' },
            { label: 'Fun', description: 'Entertainment & engagement', value: 'fun' },
            { label: 'Economy', description: 'Coins ledger, bank, transfers & rankings', value: 'economy' },
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
            .setLabel('Bot Docs & Guide')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/bot`)
            .setEmoji('📖'),
        new ButtonBuilder()
            .setLabel('Invite Bot')
            .setStyle(ButtonStyle.Link)
            .setURL(INVITE_URL),
        new ButtonBuilder()
            .setLabel('Support Hub')
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
        .setDMPermission(true),

    cooldown: 3,

    async execute(interaction) {
        await interaction.deferReply({ flags: EPH | V2 });

        const settings = interaction.guildId ? await supabase.getBotSettings(interaction.guildId).catch(() => null) : null;
        const prefix = settings?.prefix || '!';

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        container.addMediaGalleryComponents(ComponentsV2.mediaGallery(CATEGORY_ARTWORK.main));

        const body = `-# 💫 VICTUS CLOUD CONNECTION • COMMAND LAYER\n` +
            `# Victus Cloud Support Hub\n\n` +
            `Welcome, **${interaction.user.username}**. Synced with the main console, this panel grants access to all operational commands.\n\n` +
            `### 🎮 Featured Fun & RPG Commands (100% Real COINS)\n` +
            `› ⛏️ **Mining & Fishing:** \`/mine\` · \`/fish\` · \`/rpg inv\` · \`/rpg sell\` · \`/rpg craft\`\n` +
            `› 🎲 **Atomic Gambling:** \`/coinflip <amount>\` · \`/slots <amount>\` · \`/heist @user <amount>\`\n` +
            `› 🐉 **World Bosses & Mobs:** \`/boss\` · \`/attack\` · \`/tame\` · \`/zoo\` · \`/battle @user <wager>\`\n` +
            `› ⚡ **Cross-Server Leveling:** \`/rank\` · \`/level\` · \`/leaderboard\` *(+100 COINS / level up)*\n` +
            `› 🛡️ **Minecraft Server Tools:** \`/server\` · \`/mc-skin\` · \`/mc-status\` · \`/mc-whitelist\` · \`/backup-world\`\n` +
            `› 🎁 **Community Rewards:** \`/battlepass\` · \`/claim\` · \`/owner-stats\` · \`/host\`\n\n` +
            `### ⚙️ Quick Connection Details\n` +
            `› **Server Prefix:** \`${prefix}\`\n` +
            `› **Bot Prefix:** \`!\` / Mention prefix (e.g. <@${interaction.client.user?.id}>)\n` +
            `› **Live Services:** Synced with [victuscloud.com](https://victuscloud.com)\n\n` +
            `Use the dropdown menu below to inspect specific modules.`;

        container.addTextDisplayComponents(ComponentsV2.text(body))
            .addSeparatorComponents(ComponentsV2.separator())
            .addActionRowComponents(getButtons())
            .addActionRowComponents(getSelectMenu('main'))
            .addTextDisplayComponents(ComponentsV2.text(`-# Private session • Victus Cloud v${config.bot.linkTokenExpiryMinutes ? '2.4' : '2.0'}`));

        await interaction.editReply({
            components: [container],
            flags: V2,
        });
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'help_category') return;

        const category = interaction.values[0] || 'main';
        const settings = interaction.guildId ? await supabase.getBotSettings(interaction.guildId).catch(() => null) : null;
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
                    `### 🎮 Featured Fun & RPG Commands (100% Real COINS)\n` +
                    `› ⛏️ **Mining & Fishing:** \`/mine\` · \`/fish\` · \`/rpg inv\` · \`/rpg sell\` · \`/rpg craft\`\n` +
                    `› 🎲 **Atomic Gambling:** \`/coinflip <amount>\` · \`/slots <amount>\` · \`/heist @user <amount>\`\n` +
                    `› 🐉 **World Bosses & Mobs:** \`/boss\` · \`/attack\` · \`/tame\` · \`/zoo\` · \`/battle @user <wager>\`\n` +
                    `› ⚡ **Cross-Server Leveling:** \`/rank\` · \`/level\` · \`/leaderboard\` *(+100 COINS / level up)*\n` +
                    `› 🛡️ **Minecraft Server Tools:** \`/server\` · \`/mc-skin\` · \`/mc-status\` · \`/mc-whitelist\` · \`/backup-world\`\n` +
                    `› 🎁 **Community Rewards:** \`/battlepass\` · \`/claim\` · \`/owner-stats\` · \`/host\`\n\n` +
                    `### ⚙️ Quick Connection Details\n` +
                    `› **Server Prefix:** \`${prefix}\`\n` +
                    `› **Bot Prefix:** \`!\` / Mention prefix\n` +
                    `› **Live Services:** Synced with [victuscloud.com](https://victuscloud.com)\n\n` +
                    `Use the dropdown menu below to inspect specific modules.`;
                break;

            case 'viral_rpg':
                title = 'Viral RPG & Minecraft Hosting Engine';
                desc = `Earn real Victus Cloud COINS, battle World Bosses, and manage your Minecraft infrastructure!\n\n` +
                    `### ⛏️ Minecraft Text-RPG\n` +
                    `› \`/mine\` • Mine underground for Coal, Iron, Gold, Diamonds & Netherite.\n` +
                    `› \`/fish\` • Cast line for Cod, Salmon, Tropical Fish & Sunken Treasure.\n` +
                    `› \`/rpg inv\` • View pickaxe & fishing rod gear tiers and material stocks.\n` +
                    `› \`/rpg sell\` • Exchange mined ores & fish for real Victus Cloud COINS!\n` +
                    `› \`/rpg craft\` • Upgrade to Stone, Iron, Diamond, or Netherite equipment.\n\n` +
                    `### 🎲 High-Stakes Gambling (Real COINS)\n` +
                    `› \`/coinflip <amount> [choice]\` • Double-or-nothing coinflip.\n` +
                    `› \`/slots <amount>\` • 3-reel Minecraft slots with Wither Skull jackpot.\n` +
                    `› \`/heist @user <amount>\` • Organize 5-player squad vault heists.\n\n` +
                    `### 🐉 World Boss Raids & Mob Gacha\n` +
                    `› \`/boss\` • View active cross-server Ender Dragon/Wither raid HP.\n` +
                    `› \`/attack [melee/bow/magic]\` • Deal damage to split the 1,000 COINS pool.\n` +
                    `› \`/tame\` & \`/zoo\` • Capture wild mobs and inspect your sanctuary.\n` +
                    `› \`/battle @user <wager>\` • PvP turn-based mob arena duels.\n\n` +
                    `### 🛡️ Server Utilities & Community Retention\n` +
                    `› \`/server <start/restart/status>\` • Power controls & live RAM/CPU gauges.\n` +
                    `› \`/mc-skin <ign>\` & \`/mc-status <ip>\` • 3D player skins & live server pings.\n` +
                    `› \`/mc-whitelist <ign>\` • Whitelist players to your server console.\n` +
                    `› \`/backup-world\` • 1-Click Lifeboat backup from 3rd-party hosts.\n` +
                    `› \`/battlepass\` • Server Battle Pass (Level 5 = +1GB RAM, Level 10 = Subdomain).\n` +
                    `› \`/claim\` • Intercept 10 COINS Supply AirDrops during quiet chat.\n` +
                    `› \`/owner-stats\` & \`/host\` • Server owner monetization metrics & referral embeds.\n\n` +
                    `_Full interactive documentation with architecture diagrams: [victuscloud.com/bot](https://victuscloud.com/bot)_`;
                break;

            case 'administration':

                title = 'Administration Panel';
                desc = `Commands to customize your server layout, bind database profiles, and set roles.\n\n` +
                    `### Command Catalog\n` +
                    `› \`/config\` • Configure log channels, role locks, and tickets.\n` +
                    `› \`/levelchannel set <channel>\` • Set target channel for level-up & rank-up broadcasts.\n` +
                    `› \`/levelchannel view\` • View current level-up broadcast channel.\n` +
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
                    `› \`/server <status/start/restart>\` • Manage your Victus Minecraft server directly in Discord.\n` +
                    `› \`/mc-skin <ign>\` • Render 3D isometric player skins and avatars.\n` +
                    `› \`/mc-status <server_ip>\` • Ping any Minecraft server for MOTD, online players, and ping.\n` +
                    `› \`/mc-whitelist <ign>\` • Whitelist Minecraft accounts into your server.\n` +
                    `› \`/backup-world\` • 1-Click Lifeboat world backup and migration.\n` +
                    `› \`/levelchannel set/view\` • Set level-up and rank-up announcement channel.\n` +
                    `› \`/ask <question>\` • Consult Groq-powered AI for server management.\n` +
                    `› \`/afk [reason]\` • Set your status to AFK.\n` +
                    `› \`/poll create\` • Launch a server-wide interactive poll.\n` +
                    `› \`/reactroles setup\` • Create self-assignable role panels.\n` +
                    `› \`/serverstats setup\` • Auto-update voice channels showing server statistics.\n` +
                    `› \`/vpsstats\` • View host resource usage of the Victus Cloud VPS.\n` +
                    `› \`/welcome setup\` • Configure welcome system and join auto-roles.\n` +
                    `› \`/link <token>\` • Connect Discord with your website account.\n` +
                    `› \`/unlink\` • Disconnect linked profile.\n` +
                    `› \`/community-coins\` • Publish this server for Community Coins.\n` +
                    `› \`/help\` • Toggle this support dashboard.`;
                break;

            case 'fun':
                title = 'Fun & Entertainment Hub';
                desc = `Full suite of high-engagement mini-games, RPG systems, and betting — all backed by real COINS!\n\n` +
                    `### ⛏️ Minecraft RPG Engine\n` +
                    `› \`/mine\` • Mine underground stone, coal, iron, gold, diamond, netherite.\n` +
                    `› \`/fish\` • Cast line into rivers, oceans, and deep trenches.\n` +
                    `› \`/rpg inv\` • View equipment tier, durability, and raw materials.\n` +
                    `› \`/rpg sell\` • Liquidate gathered resources into real Victus COINS.\n` +
                    `› \`/rpg craft\` • Forge higher tier pickaxes and rods.\n\n` +
                    `### 🎲 COINS Gambling & Heists\n` +
                    `› \`/coinflip <amount> [choice]\` • Fast 50/50 double-or-nothing wagers.\n` +
                    `› \`/slots <amount>\` • 3-reel spinning slots with 50x Wither Jackpot.\n` +
                    `› \`/heist @user <amount>\` • 5-player co-op bank heist minigame.\n\n` +
                    `### 🐉 World Bosses & Arena Pets\n` +
                    `› \`/boss\` • Check global World Boss raid status (Ender Dragon, Wither).\n` +
                    `› \`/attack [melee/bow/magic]\` • Deal damage and claim shares of 1,000 COINS bounty.\n` +
                    `› \`/tame\` & \`/zoo\` • Capture wild mobs and view your pet bestiary.\n` +
                    `› \`/battle @user <wager>\` • PvP pet battles with wagered COINS.\n\n` +
                    `### ⚡ Progression & AirDrops\n` +
                    `› \`/rank [user]\` • View full tier rank card, level progress & COINS earnings.\n` +
                    `› \`/level [user]\` • View XP, current level, and progress bar.\n` +
                    `› \`/leaderboard\` • Inspect global top earners, levels, and miners.\n` +
                    `› \`/claim\` • Snatch random supply AirDrops in active chat.\n` +
                    `› \`/battlepass\` • Progress through 10 tiers of server RAM & subdomain perks.`;
                break;

            case 'economy':
                title = 'Victus Economy & Wallet';
                desc = `Manage Coins, credit sync, bank ledgers, and rankings. 100% real currency usable on server hosting!\n\n` +
                    `### Command Catalog\n` +
                    `› \`/rank [user]\` • View synced global rank tier, level, and COINS rewards.\n` +
                    `› \`/level [user]\` • View synchronized XP and progress (+100 COINS/lvl).\n` +
                    `› \`/account\` • Main dashboard displaying Coins, level, and billing credits.\n` +
                    `› \`/economy\` • Open the interactive bank, transfer, and wallet panel.\n` +
                    `› \`/leaderboard\` • Global richest players, levels, and community rankings.\n` +
                    `› \`/pricing\` • Live pricing for RAM, CPU cores, and storage in COINS/EUR.\n` +
                    `› \`/currency\` • Real-time exchange rates across EUR, USD, and COINS.\n` +
                    `› \`/rpg sell\` • Convert mined ores and caught fish into real COINS.\n\n` +
                    `_All earned COINS are canonical and can be spent on free hosting at [victuscloud.com/free](https://victuscloud.com/free)._`;
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
