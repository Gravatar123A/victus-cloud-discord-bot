import {
    SlashCommandBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore, BotAllianceWar, BotSmpServer } from '../services/viralExpansionStore.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
import { config } from '../config.js';

function renderProgressBar(current: number, needed: number, size = 14): string {
    const ratio = Math.max(0, Math.min(1, current / (needed || 1)));
    const filled = Math.round(ratio * size);
    const empty = size - filled;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(ratio * 100)}%\``;
}

export const battlepassCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('battlepass')
        .setDescription('View the server Battle Pass level, milestone rewards, and contributor XP'),

    cooldown: 4,

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Use this command inside a Discord server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const botGuild = await viralExpansionStore.getGuild(interaction.guild.id, interaction.guild.ownerId);
        const currentLvl = botGuild.guild_level;
        const currentXp = botGuild.guild_xp;

        // XP needed for next level: 500 * (L)^2
        const nextLevelXp = 500 * Math.pow(currentLvl, 2);
        const prevLevelXp = 500 * Math.pow(currentLvl - 1, 2);
        const progressXp = currentXp - prevLevelXp;
        const neededXp = nextLevelXp - prevLevelXp;
        const bar = renderProgressBar(progressXp, neededXp);

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);

        const text = `# 🎖️ Server Battle Pass: ${interaction.guild.name}\n\n` +
            `Your community gains Battle Pass XP from chat activity, \`/mine\` expeditions, and server referrals!\n\n` +
            `### 📈 Progress to Level ${currentLvl + 1}\n` +
            `› **Current Level:** **Level ${currentLvl}**\n` +
            `› **Total XP:** \`${currentXp.toLocaleString()} XP\`\n` +
            `› **Progress:** ${bar} (\`${progressXp.toLocaleString()} / ${neededXp.toLocaleString()} XP\`)\n\n` +
            `### 🎁 Milestone Perks:\n` +
            `› **Level 5 Milestone:** ${botGuild.ram_bonus_claimed ? '✅ **Unlocked**' : '🔒 **Locked**'} — Free +1GB RAM Hosting Credit on Victus Cloud\n` +
            `› **Level 10 Milestone:** ${botGuild.subdomain_unlocked ? '✅ **Unlocked**' : '🔒 **Locked**'} — Free Custom Subdomain (\`mysmp.victus.gg\`)\n` +
            `› **Level 20 Milestone:** 🔒 **Locked** — Dedicated VPS Node Upgrade\n\n` +
            `-# Server owner <@${interaction.guild.ownerId}> receives all server infrastructure rewards automatically!`;

        container.addTextDisplayComponents(ComponentsV2.text(text));

        const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setLabel('View Server Cloud Panel')
                .setURL(`${config.branding.website}/free`)
                .setStyle(ButtonStyle.Link)
                .setEmoji('☁️')
        );

        await interaction.reply({ components: [container, btnRow], flags: ComponentsV2.IS_COMPONENTS_V2 });
    },
};

export const claimAirDropCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim an active Victus Cloud Supply AirDrop crate in the channel'),

    cooldown: 2,

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Use this command inside a Discord server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const res = await viralExpansionService.claimAirDrop(interaction.guild.id, interaction.user);
        if (res.success) {
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            c.addTextDisplayComponents(ComponentsV2.text(res.message));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
        } else {
            await interaction.reply({ content: res.message, flags: MessageFlags.Ephemeral });
        }
    },
};

export const smpNetworkCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('smp-network')
        .setDescription('Explore or promote Minecraft SMP servers in the cross-server directory')
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('View top Minecraft SMP communities')
        )
        .addSubcommand((sub) =>
            sub
                .setName('register')
                .setDescription('Register this server into the public SMP Network directory')
                .addStringOption((opt) =>
                    opt.setName('name').setDescription('Server name').setRequired(true)
                )
                .addStringOption((opt) =>
                    opt.setName('ip').setDescription('Server IP address or domain').setRequired(true)
                )
                .addIntegerOption((opt) =>
                    opt.setName('port').setDescription('Port (default 25565)').setRequired(false)
                )
                .addStringOption((opt) =>
                    opt.setName('category').setDescription('Category (Survival, Lifesteal, Skyblock, RPG)').setRequired(false)
                )
                .addStringOption((opt) =>
                    opt.setName('description').setDescription('Short description of your server').setRequired(false)
                )
        ),

    cooldown: 4,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            const servers = await viralExpansionStore.getSmpServers(8);
            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);

            if (servers.length === 0) {
                container.addTextDisplayComponents(
                    ComponentsV2.text(
                        `# 🌐 Victus SMP Network Directory\n\n` +
                        `No servers have been listed yet! Be the first server to register with \`/smp-network register\`!`
                    )
                );
                await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }

            const entries = servers.map((s, idx) => {
                return `**${idx + 1}. ${s.server_name}** [${s.category}]\n` +
                    `› **Address:** \`${s.ip}${s.port !== 25565 ? `:${s.port}` : ''}\`\n` +
                    `› **Description:** ${s.description || 'Community Minecraft Server'}\n` +
                    `› **Votes:** \`${s.votes} votes\``;
            }).join('\n\n');

            const text = `# 🌐 Victus SMP Network Directory\n\n` +
                `Discover top Minecraft SMP communities running across the Victus Cloud Network!\n\n` +
                `### 🎮 Featured Servers:\n${entries}\n\n` +
                `-# Register your community with \`/smp-network register\`!`;

            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }

        if (sub === 'register') {
            if (!interaction.guild) {
                await interaction.reply({ content: 'Use this command inside a server.', flags: MessageFlags.Ephemeral });
                return;
            }

            const name = interaction.options.getString('name', true).trim();
            const ip = interaction.options.getString('ip', true).trim();
            const port = interaction.options.getInteger('port') || 25565;
            const category = interaction.options.getString('category') || 'Survival SMP';
            const description = interaction.options.getString('description') || 'Active Minecraft Server';

            const server = await viralExpansionStore.registerSmpServer({
                guild_id: interaction.guild.id,
                server_name: name,
                ip,
                port,
                is_bedrock: false,
                category,
                description,
            });

            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            const text = `# 🌐 Server Published to SMP Network!\n\n` +
                `**${server.server_name}** is now publicly discoverable across the entire Victus Discord network!\n\n` +
                `› **Category:** \`${server.category}\`\n` +
                `› **IP Address:** \`${server.ip}:${server.port}\`\n` +
                `› **Listing:** Active on \`/smp-network list\`\n\n` +
                `-# High-ranking servers earn free RAM upgrades weekly!`;

            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
    },
};

export const warCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('war')
        .setDescription('Declare a 24-hour Alliance Activity War against another Discord server')
        .addSubcommand((sub) =>
            sub
                .setName('declare')
                .setDescription('Declare a 24-hour war against a target server')
                .addStringOption((opt) =>
                    opt.setName('target-guild-id').setDescription('Target Server Guild ID').setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('Check live Alliance War points and time remaining')
        ),

    cooldown: 5,

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'Use this command inside a Discord server.', flags: MessageFlags.Ephemeral });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'declare') {
            const targetGuildId = interaction.options.getString('target-guild-id', true).trim();
            if (targetGuildId === guildId) {
                await interaction.reply({ content: 'You cannot declare war on your own server!', flags: MessageFlags.Ephemeral });
                return;
            }

            const active = await viralExpansionStore.getActiveWar(guildId);
            if (active) {
                await interaction.reply({
                    content: '⚠️ Your server is already in an active 24-hour Alliance War! Check `/war status`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const newWar: BotAllianceWar = {
                id: `war_${Date.now()}`,
                guild_1_id: guildId,
                guild_2_id: targetGuildId,
                points_1: 0,
                points_2: 0,
                status: 'active',
                pool_coins: 500,
                starts_at: new Date().toISOString(),
                ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            };

            await viralExpansionStore.saveAllianceWar(newWar);

            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            const text = `# ⚔️ 24-HOUR ALLIANCE WAR DECLARED!\n\n` +
                `**${interaction.guild.name}** has declared war on Server ID \`${targetGuildId}\`!\n\n` +
                `### 🏆 The Stakes:\n` +
                `› **Prize Pool:** **500 COINS** split among top contributors of the winning server!\n` +
                `› **Duration:** 24 Hours\n` +
                `› **How to Score:** Chatting (+2 pts), \`/mine\` (+5 pts), World Boss hits (+10 pts)!\n\n` +
                `Rally your community members to chat and mine to secure the victory!`;

            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }

        if (sub === 'status') {
            const war = await viralExpansionStore.getActiveWar(guildId);
            if (!war) {
                await interaction.reply({
                    content: 'Your server is not currently engaged in any Alliance War. Declare one with `/war declare <GuildID>`!',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const isGuild1 = war.guild_1_id === guildId;
            const myPoints = isGuild1 ? war.points_1 : war.points_2;
            const enemyPoints = isGuild1 ? war.points_2 : war.points_1;
            const enemyId = isGuild1 ? war.guild_2_id : war.guild_1_id;

            const remainingMs = Math.max(0, new Date(war.ends_at).getTime() - Date.now());
            const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
            const minsLeft = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

            const container = ComponentsV2.baseContainer(
                myPoints >= enemyPoints ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger
            );

            const text = `# ⚔️ Alliance War Status\n\n` +
                `› **Opponent:** Server \`${enemyId}\`\n` +
                `› **Time Remaining:** \`${hoursLeft}h ${minsLeft}m\`\n` +
                `› **Prize Pool:** **${war.pool_coins} COINS**\n\n` +
                `### 📊 Scoreboard:\n` +
                `› **Your Server:** \`${myPoints.toLocaleString()} PTS\` ${myPoints >= enemyPoints ? '👑 (LEADING)' : ''}\n` +
                `› **Rival Server:** \`${enemyPoints.toLocaleString()} PTS\`\n\n` +
                `-# Keep chatting, mining, and fighting bosses to surge ahead!`;

            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
    },
};
