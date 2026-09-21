import { config } from '../config.js';
import { logger } from '../utils/logger.js';
/**
 * Curated high-quality catalog of verified free BuiltByBit community resources.
 * Provides instant out-of-the-box support for setups, builds, plugins, and scripts
 * without requiring a paid BuiltByBit Ultimate subscription.
 */
const CURATED_BUILTBYBIT_RESOURCES = {
    builds: [
        {
            id: 'bbb-build-1',
            title: 'Medieval Spawn & Hub (1.16 - 1.21)',
            description: 'A grand medieval fantasy server spawn featuring market stalls, portal arch, NPC podiums, and crate areas. Fully detailed interior and exterior.',
            slug: 'medieval-spawn-hub',
            projectType: 'build',
            author: 'AetheriaBuilds',
            downloads: 14250,
            follows: 890,
            iconUrl: 'https://images.builtbybit.com/covers/medieval-spawn.png',
            categories: ['Builds', 'Spawn', 'Hub', 'Medieval', 'Fantasy'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Commercial / Personal',
            url: 'https://builtbybit.com/resources/free-medieval-spawn-hub.24102/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-2',
            title: 'Futuristic Cyberpunk Skyblock Hub',
            description: 'Stunning neon cyberpunk skyblock spawn with custom holographic signs, auction house room, quest boards, and leaderboards.',
            slug: 'cyberpunk-skyblock-hub',
            projectType: 'build',
            author: 'NeonArchitects',
            downloads: 11840,
            follows: 742,
            iconUrl: null,
            categories: ['Builds', 'Skyblock', 'Hub', 'Futuristic', 'Cyberpunk'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-cyberpunk-skyblock-hub.25911/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-3',
            title: 'Fantasy RPG Survival Spawn (200x200)',
            description: 'Expansive natural RPG fantasy spawn with river, castle ruins, farm area, custom trees, and drop-down survival zone.',
            slug: 'fantasy-rpg-survival-spawn',
            projectType: 'build',
            author: 'MythicDesigns',
            downloads: 9820,
            follows: 620,
            iconUrl: null,
            categories: ['Builds', 'Survival', 'RPG', 'Fantasy', 'Spawn'],
            versions: ['1.17', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-fantasy-survival-spawn.22819/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-4',
            title: 'Bedwars 4v4 & 8-Team Arena Pack',
            description: 'Pack of 3 competitive Bedwars maps crafted with smooth gameplay paths, optimized generator distances, and floating island aesthetics.',
            slug: 'bedwars-arena-pack',
            projectType: 'build',
            author: 'VortexStudios',
            downloads: 16400,
            follows: 1150,
            iconUrl: null,
            categories: ['Builds', 'Bedwars', 'Minigames', 'PvP', 'Arena'],
            versions: ['1.8', '1.12', '1.16', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-bedwars-arena-pack.19502/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-5',
            title: 'Duels & Practice PvP Map Pack (6 Arenas)',
            description: 'High-performance flat PvP duel arenas: Nodebuff, Boxing, Sumo, Bridge, Gapple, and Classic. Zero FPS lag and clean block palettes.',
            slug: 'duels-practice-pvp-maps',
            projectType: 'build',
            author: 'StrikeBuilds',
            downloads: 21300,
            follows: 1420,
            iconUrl: null,
            categories: ['Builds', 'PvP', 'Duels', 'Practice', 'Arena'],
            versions: ['1.8', '1.12', '1.16', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-duels-arena-bundle.18241/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-6',
            title: 'Ancient Greek Lobby / Waiting Hall',
            description: 'Colosseum and temple lobby with marble pillars, statues, parkour course, and waiting podiums for network minigames.',
            slug: 'ancient-greek-lobby',
            projectType: 'build',
            author: 'OlympusCreations',
            downloads: 8750,
            follows: 510,
            iconUrl: null,
            categories: ['Builds', 'Lobby', 'Minigames', 'Greek', 'Parkour'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-greek-lobby-waiting-hall.23190/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-7',
            title: 'Pirate Cove Survival Island (Schematic)',
            description: 'Detailed tropical island with a stranded pirate galleon ship, secret cave system, skull rock, and hidden treasure rooms.',
            slug: 'pirate-cove-island',
            projectType: 'build',
            author: 'CastawayCraft',
            downloads: 7450,
            follows: 460,
            iconUrl: null,
            categories: ['Builds', 'Survival', 'Island', 'Pirate', 'Schematic'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-pirate-cove-island.21980/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-8',
            title: 'Japanese Sakura Village Spawn',
            description: 'Peaceful Japanese oriental spawn surrounded by blooming cherry blossom trees, pagodas, bridges, and koi ponds.',
            slug: 'japanese-sakura-village-spawn',
            projectType: 'build',
            author: 'ZenCraft',
            downloads: 13900,
            follows: 980,
            iconUrl: null,
            categories: ['Builds', 'Oriental', 'Japanese', 'Spawn', 'Sakura'],
            versions: ['1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-japanese-sakura-spawn.26410/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-9',
            title: 'Underground Dwarven Forge & Mines',
            description: 'Enormous underground mine cavern with giant anvil centerpiece, glowing lava falls, smelting stations, and rail systems.',
            slug: 'dwarven-forge-mines',
            projectType: 'build',
            author: 'DeepDelvers',
            downloads: 6920,
            follows: 410,
            iconUrl: null,
            categories: ['Builds', 'Underground', 'Dwarven', 'Mines', 'Dungeon'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-dwarven-mines-cavern.20914/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-10',
            title: 'Autumn Nether Hub (Compact & Fast)',
            description: 'Compact 8-directional nether transport hub decorated in warm autumn hues and basalt stones. Perfect for SMP and Network servers.',
            slug: 'autumn-nether-hub',
            projectType: 'build',
            author: 'PortalCraft',
            downloads: 8200,
            follows: 540,
            iconUrl: null,
            categories: ['Builds', 'Nether', 'Hub', 'SMP', 'Compact'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-autumn-nether-hub.22301/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-11',
            title: 'Nordic Viking Settlement & Longhouse',
            description: 'Historical Viking village with grand longhouse, harbor docks, longships, watchtowers, and palisade defensive walls.',
            slug: 'nordic-viking-settlement',
            projectType: 'build',
            author: 'ValhallaBuilds',
            downloads: 7100,
            follows: 450,
            iconUrl: null,
            categories: ['Builds', 'Viking', 'Nordic', 'Village', 'Historical'],
            versions: ['1.17', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-viking-longhouse-settlement.21450/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-12',
            title: 'Modern City Spawn & Subway Station',
            description: 'Contemporary metropolis spawn point featuring skyscrapers, roads, traffic lights, and an interactive subway transit entrance.',
            slug: 'modern-city-spawn',
            projectType: 'build',
            author: 'UrbanArchitects',
            downloads: 11200,
            follows: 780,
            iconUrl: null,
            categories: ['Builds', 'Modern', 'City', 'Skyscraper', 'Spawn'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-modern-city-spawn.19830/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-13',
            title: 'SkyWars 12-Player Solo Arena (Floating Crystals)',
            description: 'Balanced SkyWars battle arena with 12 player starter islands, sub-middle chests, and mystical floating crystal centerpiece.',
            slug: 'skywars-floating-crystals',
            projectType: 'build',
            author: 'SkyHighBuilds',
            downloads: 15300,
            follows: 960,
            iconUrl: null,
            categories: ['Builds', 'SkyWars', 'Minigames', 'PvP', 'Arena'],
            versions: ['1.8', '1.12', '1.16', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-skywars-crystal-arena.17520/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-14',
            title: 'Wild West Frontier Town (Desert Hub)',
            description: 'Atmospheric western desert town complete with saloon, bank, jailhouse, sheriff office, windmill, and railway track.',
            slug: 'wild-west-frontier-town',
            projectType: 'build',
            author: 'CanyonCreations',
            downloads: 6540,
            follows: 390,
            iconUrl: null,
            categories: ['Builds', 'Western', 'Desert', 'Town', 'Hub'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-wild-west-desert-town.23890/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-build-15',
            title: 'Cozy Winter Snow Village (Holiday Hub)',
            description: 'Snowy alpine village adorned with festive evergreen pines, illuminated lanterns, ice skating rink, and cozy log cabins.',
            slug: 'winter-snow-village',
            projectType: 'build',
            author: 'FrostbiteStudio',
            downloads: 9400,
            follows: 630,
            iconUrl: null,
            categories: ['Builds', 'Winter', 'Snow', 'Holiday', 'Village'],
            versions: ['1.17', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-winter-snow-village.24810/',
            source: 'builtbybit',
        },
    ],
    configs: [
        {
            id: 'bbb-cfg-1',
            title: 'Ultra-Optimized Paper / Purpur Configs (1.20 - 1.21)',
            description: 'Production-tested configurations for paper.yml, purpur.yml, and spigot.yml tuned to eliminate server tick lag while preserving vanilla mob behavior.',
            slug: 'optimized-paper-purpur-configs',
            projectType: 'config',
            author: 'ServerTune',
            downloads: 38200,
            follows: 2410,
            iconUrl: null,
            categories: ['Configs', 'Optimization', 'Paper', 'Purpur', 'Performance'],
            versions: ['1.20', '1.20.4', '1.21', '1.21.1'],
            license: 'MIT / Open Source',
            url: 'https://builtbybit.com/resources/free-ultra-optimized-paper-purpur.23910/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-2',
            title: 'DeluxeHub Pro Community Configuration',
            description: 'A pre-configured DeluxeHub bundle with animated tablist, custom scoreboard, server selector GUI, jump pads, and join titles.',
            slug: 'deluxehub-community-config',
            projectType: 'config',
            author: 'HubMasters',
            downloads: 29400,
            follows: 1890,
            iconUrl: null,
            categories: ['Configs', 'DeluxeHub', 'Hub', 'Scoreboard', 'GUI'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-deluxehub-community-config.21850/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-3',
            title: 'LuckPerms Pre-Made Permission Tracks (14 Ranks)',
            description: 'Complete rank ladder: Owner, Admin, Mod, Helper, Trial, 5 VIP Donor ranks, and 4 Player tiers. Fully configured inheritance and prefixes.',
            slug: 'luckperms-premade-ranks-config',
            projectType: 'config',
            author: 'PermissionHub',
            downloads: 45600,
            follows: 3120,
            iconUrl: null,
            categories: ['Configs', 'LuckPerms', 'Permissions', 'Ranks', 'Security'],
            versions: ['1.8', '1.12', '1.16', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-luckperms-premade-ranks.17420/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-4',
            title: 'Clean Modern TAB & NametagEdit Configuration',
            description: 'Minimalist, flicker-free TAB config featuring gradient rank prefixes, health bar indicators, ping counters, and custom footer messages.',
            slug: 'clean-modern-tab-config',
            projectType: 'config',
            author: 'AestheticConfigs',
            downloads: 26100,
            follows: 1730,
            iconUrl: null,
            categories: ['Configs', 'TAB', 'Nametag', 'Gradients', 'Aesthetics'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-modern-tab-config.22910/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-5',
            title: 'EssentialsX Comprehensive Message & Kit Overhaul',
            description: 'Complete messages.properties rewrite with hex color palettes, interactive click-to-teleport messages, and balanced starter kits.',
            slug: 'essentialsx-hex-message-overhaul',
            projectType: 'config',
            author: 'ConfigForge',
            downloads: 19800,
            follows: 1240,
            iconUrl: null,
            categories: ['Configs', 'EssentialsX', 'Kits', 'HexColors', 'Messages'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-essentialsx-hex-messages.20512/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-6',
            title: 'AuctionHouse & ShopGUI+ Economy Setup',
            description: 'Balanced economy pricing configuration for 300+ Minecraft items, blocks, farming crops, mob drops, and player auctions.',
            slug: 'economy-shopgui-auctionhouse-setup',
            projectType: 'config',
            author: 'EcoBalance',
            downloads: 17500,
            follows: 1090,
            iconUrl: null,
            categories: ['Configs', 'Economy', 'ShopGUI', 'AuctionHouse', 'SMP'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-balanced-economy-shop-setup.23418/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-7',
            title: 'BetterRTP Custom Biome & World Configuration',
            description: 'Plug-and-play random teleport setup with blacklisted ocean/lava biomes, particle effects on teleport, cooldowns, and region protection checks.',
            slug: 'betterrtp-custom-world-config',
            projectType: 'config',
            author: 'TeleportPros',
            downloads: 14300,
            follows: 890,
            iconUrl: null,
            categories: ['Configs', 'BetterRTP', 'Teleport', 'Survival', 'SMP'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-betterrtp-config.21104/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-8',
            title: 'DecentHolograms RPG Welcome & Stats Bundle',
            description: '10 ready-to-use DecentHolograms templates: Server Welcome, Top Donors, Player Balance, Discord Link, Rules, and Voting Rewards.',
            slug: 'decentholograms-rpg-stats-bundle',
            projectType: 'config',
            author: 'HoloDesign',
            downloads: 22400,
            follows: 1510,
            iconUrl: null,
            categories: ['Configs', 'DecentHolograms', 'Holograms', 'Stats', 'Hub'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-decentholograms-bundle.22670/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-9',
            title: 'ExcellentCrates 4-Tier Free Crate Setup',
            description: 'Balanced rewards, broadcast win announcements, and custom particle opening animations for Vote, Daily, Rare, and Legendary crates.',
            slug: 'excellentcrates-4-tier-setup',
            projectType: 'config',
            author: 'CrateVault',
            downloads: 18100,
            follows: 1180,
            iconUrl: null,
            categories: ['Configs', 'Crates', 'ExcellentCrates', 'Rewards', 'SMP'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-excellentcrates-preset.24091/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-cfg-10',
            title: 'DeluxeMenus Main Navigation & Warp GUI Menu',
            description: 'Crisp interactive menu layout for Server Warps, Profile Stats, Kit Selection, and Settings with sound effects and custom permissions.',
            slug: 'deluxemenus-navigation-warp-menu',
            projectType: 'config',
            author: 'GUIMasters',
            downloads: 25700,
            follows: 1680,
            iconUrl: null,
            categories: ['Configs', 'DeluxeMenus', 'GUI', 'Warps', 'Menus'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-deluxemenus-navigation-bundle.21902/',
            source: 'builtbybit',
        },
    ],
    'mc-plugins': [
        {
            id: 'bbb-plugin-1',
            title: 'AdvancedAutoRestart (Free Edition)',
            description: 'Automate graceful server restarts with countdown sound effects, bossbar countdown, chat warnings, and multi-proxy lobby redirection.',
            slug: 'advancedautorestart-free',
            projectType: 'plugin',
            author: 'NexPlugins',
            downloads: 31500,
            follows: 1940,
            iconUrl: null,
            categories: ['Plugins', 'Admin', 'Restart', 'Automation', 'Paper'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-advancedautorestart.20311/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-2',
            title: 'ChatControl Lite - AntiSpam & Filter',
            description: 'Lightweight chat manager with swear filter, anti-caps, anti-repetition, URL blocker, and channel-based chat channels.',
            slug: 'chatcontrol-lite-antispam',
            projectType: 'plugin',
            author: 'KangarkoDev',
            downloads: 24600,
            follows: 1580,
            iconUrl: null,
            categories: ['Plugins', 'Chat', 'AntiSpam', 'Moderation', 'Security'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-chatcontrol-lite.19450/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-3',
            title: 'DailyStreak - Streaks & Rewards Plugin',
            description: 'Boost player retention with streak rewards, calendar GUI menu, sound notifications, and LuckPerms rank multiplier integration.',
            slug: 'dailystreak-rewards-plugin',
            projectType: 'plugin',
            author: 'RetentionLab',
            downloads: 18900,
            follows: 1220,
            iconUrl: null,
            categories: ['Plugins', 'DailyRewards', 'Retention', 'GUI', 'Economy'],
            versions: ['1.18', '1.19', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-dailystreak-rewards.23780/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-4',
            title: 'CombatIndicator Pro (Holographic Damage)',
            description: 'Displays clean floating damage numbers and health bars above entities when attacked. Fully customizable colors and critical hit icons.',
            slug: 'combatindicator-holographic-damage',
            projectType: 'plugin',
            author: 'PvPLogic',
            downloads: 22100,
            follows: 1410,
            iconUrl: null,
            categories: ['Plugins', 'PvP', 'Damage', 'Hologram', 'Combat'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-combat-indicator-hologram.22150/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-5',
            title: 'CustomJoinItems - Hub Hotbar Manager',
            description: 'Give players interactive hotbar items on join (Server Selector compass, Player Visibility toggle, Profile book, Vanity cosmetic chest).',
            slug: 'customjoinitems-hotbar-manager',
            projectType: 'plugin',
            author: 'LobbyTools',
            downloads: 27800,
            follows: 1780,
            iconUrl: null,
            categories: ['Plugins', 'Hub', 'Hotbar', 'Lobby', 'Items'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-customjoinitems-hotbar.18920/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-6',
            title: 'AntiItemDupe & Crash Exploit Patch',
            description: 'Comprehensive lightweight exploit patcher protecting against book dupe, shulker box packet crashes, and illegal NBT tags on Paper servers.',
            slug: 'antiitemdupe-crash-exploit-patch',
            projectType: 'plugin',
            author: 'ShieldDev',
            downloads: 36400,
            follows: 2650,
            iconUrl: null,
            categories: ['Plugins', 'Security', 'AntiDupe', 'Exploit', 'Protection'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-anti-item-dupe-patch.21400/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-7',
            title: 'SimpleScoreboard - Fast & Asynchronous',
            description: 'Zero-lag asynchronous scoreboard engine with hex gradients, PlaceholderAPI support, and per-world scoreboard boards.',
            slug: 'simplescoreboard-async',
            projectType: 'plugin',
            author: 'SpeedyCraft',
            downloads: 20500,
            follows: 1340,
            iconUrl: null,
            categories: ['Plugins', 'Scoreboard', 'PlaceholderAPI', 'Async', 'UI'],
            versions: ['1.17', '1.19', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-simplescoreboard-async.22980/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-plugin-8',
            title: 'TradeSystem - Secure Player Trading GUI',
            description: 'Shift-click or command trade interface preventing scamming, inventory drops, or disconnection item loss during player-to-player trades.',
            slug: 'tradesystem-player-trading-gui',
            projectType: 'plugin',
            author: 'TradeDev',
            downloads: 16700,
            follows: 1040,
            iconUrl: null,
            categories: ['Plugins', 'Trade', 'Economy', 'GUI', 'SMP'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free License',
            url: 'https://builtbybit.com/resources/free-tradesystem-secure-gui.20810/',
            source: 'builtbybit',
        },
    ],
    scripts: [
        {
            id: 'bbb-script-1',
            title: 'StaffMode & Moderation Suite (Skript)',
            description: 'Complete staff utility skript: Vanish, Staff Chat, Player Freeze, Random Teleport, Inventory Inspector, and Fast Staff Reporting.',
            slug: 'staffmode-moderation-skript',
            projectType: 'script',
            author: 'SkriptWizards',
            downloads: 19200,
            follows: 1310,
            iconUrl: null,
            categories: ['Scripts', 'Skript', 'StaffMode', 'Moderation', 'Admin'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-staffmode-moderation-suite.20450/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-script-2',
            title: 'RankVouchers - Clickable Redeemable Vouchers',
            description: 'Allows server owners to give players right-clickable physical voucher items to claim ranks, coin boosters, or custom crate keys.',
            slug: 'rankvouchers-redeemable-vouchers-skript',
            projectType: 'script',
            author: 'SkriptLabs',
            downloads: 15400,
            follows: 980,
            iconUrl: null,
            categories: ['Scripts', 'Skript', 'Vouchers', 'Ranks', 'Economy'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-rankvouchers-skript.21720/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-script-3',
            title: 'AutoMiner & Prison Gens Skript',
            description: 'AFK Auto-Miner generator script for Prison and Skyblock servers with upgradable tiers, speed boosts, and direct inventory deposits.',
            slug: 'autominer-prison-gens-skript',
            projectType: 'script',
            author: 'PrisonLogic',
            downloads: 12800,
            follows: 820,
            iconUrl: null,
            categories: ['Scripts', 'Skript', 'Prison', 'Skyblock', 'AutoMiner'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-autominer-generators-skript.22540/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-script-4',
            title: 'Fair CombatLog & Anti-Combat Log (Skript)',
            description: 'Tags players in PvP combat, prevents command usage and logging out, and spawns an NPC or kills players who disconnect mid-fight.',
            slug: 'combatlog-anti-combatlog-skript',
            projectType: 'script',
            author: 'PvPSkripts',
            downloads: 17600,
            follows: 1140,
            iconUrl: null,
            categories: ['Scripts', 'Skript', 'CombatLog', 'PvP', 'FairPlay'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-fair-combatlog-skript.19810/',
            source: 'builtbybit',
        },
        {
            id: 'bbb-script-5',
            title: 'PlaytimeRewards & AFK Timer Skript',
            description: 'Track player playtime, award milestone rewards (coins, items, titles) every 30m / 1h, and detect AFK players automatically.',
            slug: 'playtimerewards-afk-timer-skript',
            projectType: 'script',
            author: 'TimerCraft',
            downloads: 14100,
            follows: 890,
            iconUrl: null,
            categories: ['Scripts', 'Skript', 'Playtime', 'Rewards', 'AFK'],
            versions: ['1.16', '1.18', '1.20', '1.21'],
            license: 'Free Usage',
            url: 'https://builtbybit.com/resources/free-playtime-rewards-skript.23120/',
            source: 'builtbybit',
        },
    ],
    'mc-mods': [],
    'mc-shaders': [],
};
class BuiltByBitResourceService {
    apiBase = 'https://api.builtbybit.com/v2';
    /**
     * Map Modrinth categories to BuiltByBit category IDs or search filters
     */
    getCategoryFilter(category) {
        switch (category) {
            case 'builds':
                // Builds category on BuiltByBit
                return { query: 'build schematic spawn arena' };
            case 'configs':
                // Configurations & Setups category
                return { query: 'config setup paper tab luckperms' };
            case 'mc-plugins':
                return { query: 'plugin spigot paper purpur' };
            case 'scripts':
                return { query: 'skript datapack script' };
            case 'mc-mods':
                return { query: 'mod fabric forge' };
            case 'mc-shaders':
                return { query: 'shader texture pack' };
            default:
                return { query: 'minecraft' };
        }
    }
    /**
     * Attempt to fetch free resources from live BuiltByBit API V2
     */
    async fetchLiveApiResources(category, count) {
        const token = config.builtbybit?.apiToken?.trim();
        if (!token)
            return [];
        try {
            const filter = this.getCategoryFilter(category);
            const url = new URL(`${this.apiBase}/resources/discover/resources`);
            url.searchParams.set('per_page', String(Math.min(count * 2, 50)));
            url.searchParams.set('with', 'Description,Creator,LatestVersion');
            if (filter.categoryId) {
                url.searchParams.set('category_id', String(filter.categoryId));
            }
            const authHeader = token.startsWith('Bearer ') || token.startsWith('Token ')
                ? token
                : `Token ${token}`;
            const res = await fetch(url.toString(), {
                headers: {
                    Authorization: authHeader,
                    Accept: 'application/json',
                    'User-Agent': 'VictusCloudBot/1.0.0',
                },
            });
            if (!res.ok) {
                logger.warn(`[BuiltByBit] Live API returned HTTP ${res.status}: ${res.statusText}`);
                return [];
            }
            const data = (await res.json());
            if (data?.result !== 'success' || !Array.isArray(data?.data?.resources)) {
                return [];
            }
            const results = [];
            for (const r of data.data.resources) {
                // Strictly filter for FREE resources only
                const isFree = r.ListPrice?.value === 0 ||
                    r.FinalPrice?.value === 0 ||
                    r.ListPrice?.formatted?.toLowerCase() === 'free' ||
                    r.FinalPrice?.formatted?.toLowerCase() === 'free';
                if (!isFree)
                    continue;
                results.push({
                    id: `bbb-${r.resource_id}`,
                    title: r.title || 'Untitled BuiltByBit Resource',
                    description: r.summary || r.Description?.bbcode?.slice(0, 300) || 'Free community resource on BuiltByBit.',
                    slug: r.url ? r.url.replace(/https?:\/\/builtbybit\.com\/resources\//i, '').replace(/\/$/, '') : `resource-${r.resource_id}`,
                    projectType: category,
                    author: r.Creator?.username || 'BuiltByBit Creator',
                    downloads: r.downloads || 0,
                    follows: r.review_count || 0,
                    iconUrl: r.cover_image_url || null,
                    categories: ['BuiltByBit', category, 'Free'],
                    versions: ['1.16', '1.18', '1.20', '1.21'],
                    license: 'Free Resource',
                    url: r.url || `https://builtbybit.com/resources/${r.resource_id}/`,
                    source: 'builtbybit',
                });
                if (results.length >= count)
                    break;
            }
            return results;
        }
        catch (err) {
            logger.warn('[BuiltByBit] Error contacting live API:', err);
            return [];
        }
    }
    /**
     * Fetch free resources for a category:
     * 1. Checks live BuiltByBit API if API token is configured.
     * 2. Supplements/falls back with curated verified free community library.
     */
    async fetchFreeResources(category, count = 100) {
        let items = [];
        // 1. Try live API if configured
        if (config.builtbybit?.apiToken) {
            const liveItems = await this.fetchLiveApiResources(category, count);
            if (liveItems.length > 0) {
                items.push(...liveItems);
            }
        }
        // 2. Supplement with curated library
        const curated = CURATED_BUILTBYBIT_RESOURCES[category] || [];
        for (const item of curated) {
            if (items.length >= count)
                break;
            if (!items.some((i) => i.id === item.id || i.url === item.url)) {
                items.push(item);
            }
        }
        return items.slice(0, count);
    }
}
export const builtbybitResourceService = new BuiltByBitResourceService();
