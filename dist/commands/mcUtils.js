import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { pterodactyl } from '../services/pterodactyl.js';
import { supabase } from '../services/supabase.js';
import { formatBytes } from '../utils/pagination.js';
function renderGaugeBar(percent, size = 12) {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * size);
    const empty = size - filled;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${clamped.toFixed(1)}%\``;
}
export const mcSkinCommand = {
    data: new SlashCommandBuilder()
        .setName('mc-skin')
        .setDescription('Render 3D player skin, avatar, and UUID for any Minecraft username')
        .addStringOption((opt) => opt
        .setName('username')
        .setDescription('Minecraft Java/Bedrock username')
        .setRequired(true)),
    cooldown: 3,
    async execute(interaction) {
        const username = interaction.options.getString('username', true).trim();
        const bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(username)}/right`;
        const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(username)}`;
        const downloadUrl = `https://minotar.net/download/${encodeURIComponent(username)}`;
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        container.addMediaGalleryComponents(ComponentsV2.mediaGallery(bodyUrl));
        const text = `# 👤 Minecraft Skin: ${username}\n\n` +
            `› **Username:** \`${username}\`\n` +
            `› **Avatar Icon:** [View 2D Head](${avatarUrl})\n` +
            `› **Raw Skin:** [Download Skin PNG](${downloadUrl})\n\n` +
            `-# Powered by Victus Cloud Gaming Engine`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('Download Skin')
            .setURL(downloadUrl)
            .setStyle(ButtonStyle.Link)
            .setEmoji('📥'));
        await interaction.reply({
            components: [container, btnRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
export const mcStatusCommand = {
    data: new SlashCommandBuilder()
        .setName('mc-status')
        .setDescription('Ping and inspect any Minecraft Java or Bedrock server in real time')
        .addStringOption((opt) => opt
        .setName('ip')
        .setDescription('Server IP or hostname (e.g. play.hypixel.net)')
        .setRequired(true))
        .addIntegerOption((opt) => opt
        .setName('port')
        .setDescription('Server port (default: 25565 for Java, 19132 for Bedrock)')
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('bedrock')
        .setDescription('Set to true if querying a Bedrock/Geyser server')
        .setRequired(false)),
    cooldown: 5,
    async execute(interaction) {
        const ip = interaction.options.getString('ip', true).trim();
        const isBedrock = interaction.options.getBoolean('bedrock') || false;
        const port = interaction.options.getInteger('port');
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const hostWithPort = port ? `${ip}:${port}` : ip;
        const apiUrl = isBedrock
            ? `https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(hostWithPort)}`
            : `https://api.mcsrvstat.us/3/${encodeURIComponent(hostWithPort)}`;
        try {
            const res = await fetch(apiUrl);
            const data = await res.json();
            const isOnline = data.online === true;
            const container = ComponentsV2.baseContainer(isOnline ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
            if (!isOnline) {
                const offlineText = `# 🔴 Minecraft Server Offline\n\n` +
                    `Unable to establish ping connection to **\`${hostWithPort}\`**.\n\n` +
                    `› **Status:** Offline / Unreachable\n` +
                    `› **Host:** \`${ip}\`\n\n` +
                    `_Need a 100% 24/7 uptime server with zero lag? Deploy one free on [victuscloud.com](https://victuscloud.com/free)!_`;
                container.addTextDisplayComponents(ComponentsV2.text(offlineText));
                await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
            const cleanMotd = Array.isArray(data.motd?.clean)
                ? data.motd.clean.join('\n')
                : (data.motd?.clean || 'No MOTD provided');
            const players = data.players || { online: 0, max: 0 };
            const version = data.version || 'Unknown Version';
            const software = data.software || (isBedrock ? 'Bedrock Edition' : 'Java Edition');
            const text = `# 🟢 Minecraft Server Online: ${ip}\n\n` +
                `### 📡 Server Telemetry\n` +
                `› **Address:** \`${hostWithPort}\`\n` +
                `› **Edition:** ${isBedrock ? 'Bedrock Edition' : 'Java Edition'}\n` +
                `› **Version:** \`${version}\` (${software})\n` +
                `› **Players Online:** **${players.online.toLocaleString()} / ${players.max.toLocaleString()}**\n\n` +
                `### 📜 MOTD:\n\`\`\`\n${cleanMotd}\n\`\`\`\n` +
                `-# Victus Cloud Server Telemetry`;
            container.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
        catch (err) {
            const errC = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            errC.addTextDisplayComponents(ComponentsV2.text(`# ⚠️ Ping Error\n\nCould not query \`${hostWithPort}\`: ${err.message}`));
            await interaction.editReply({ components: [errC], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
    },
};
export const mcWhitelistCommand = {
    data: new SlashCommandBuilder()
        .setName('mc-whitelist')
        .setDescription('Whitelist a player IGN directly onto your Victus Cloud Minecraft server')
        .addStringOption((opt) => opt
        .setName('ign')
        .setDescription('Minecraft in-game name to whitelist')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('server')
        .setDescription('Server identifier (from /servers list)')
        .setRequired(false)),
    cooldown: 3,
    async execute(interaction) {
        const ign = interaction.options.getString('ign', true).trim();
        const serverId = interaction.options.getString('server');
        const linked = await supabase.getLinkedAccount(interaction.user.id);
        if (!linked) {
            await interaction.reply({
                content: '⚠️ You must link your Victus Cloud account using `/link` to manage server whitelists.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        try {
            // Find server if not provided
            let targetId = serverId;
            if (!targetId) {
                const { data } = await supabase.client
                    .from('free_servers')
                    .select('pterodactyl_server_id, pterodactyl_identifier')
                    .eq('user_id', linked.user_id)
                    .limit(1)
                    .maybeSingle();
                targetId = data?.pterodactyl_identifier || data?.pterodactyl_server_id;
            }
            if (!targetId) {
                await interaction.editReply({
                    content: '❌ No active server found under your account. Please specify the `server` identifier option.',
                });
                return;
            }
            await pterodactyl.sendCommand(targetId, `whitelist add ${ign}`);
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            c.addTextDisplayComponents(ComponentsV2.text(`# 🛡️ Whitelist Command Dispatched\n\n` +
                `Successfully sent \`whitelist add ${ign}\` to server console (\`${targetId}\`)!\n\n` +
                `› **Player Added:** \`${ign}\`\n` +
                `› **Status:** Player can now join the server.`));
            await interaction.editReply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
        catch (err) {
            await interaction.editReply({
                content: `❌ Whitelist command failed: ${err.message}`,
            });
        }
    },
};
export const serverCommand = {
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('Staff controls: start, restart, and inspect live RAM/CPU gauges for your server')
        .addSubcommand((sub) => sub
        .setName('start')
        .setDescription('Power on your server')
        .addStringOption((opt) => opt.setName('identifier').setDescription('Server identifier').setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('restart')
        .setDescription('Restart your server')
        .addStringOption((opt) => opt.setName('identifier').setDescription('Server identifier').setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('status')
        .setDescription('Inspect real-time CPU, RAM, Disk usage gauges and status')
        .addStringOption((opt) => opt.setName('identifier').setDescription('Server identifier').setRequired(true))),
    cooldown: 4,
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const serverId = interaction.options.getString('identifier', true).trim();
        const linked = await supabase.getLinkedAccount(interaction.user.id);
        if (!linked) {
            await interaction.reply({
                content: '⚠️ You must link your Victus Cloud account using `/link` to manage servers.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
        try {
            if (sub === 'start') {
                await pterodactyl.sendPowerSignal(serverId, 'start');
                const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                c.addTextDisplayComponents(ComponentsV2.text(`# ⚡ Server Starting\n\nSent \`START\` signal to server \`${serverId}\`.`));
                await interaction.editReply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
            if (sub === 'restart') {
                await pterodactyl.sendPowerSignal(serverId, 'restart');
                const c = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
                c.addTextDisplayComponents(ComponentsV2.text(`# 🔄 Server Restarting\n\nSent \`RESTART\` signal to server \`${serverId}\`.`));
                await interaction.editReply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
            if (sub === 'status') {
                const res = await pterodactyl.getServerResources(serverId);
                const memoryMb = Math.round(res.resources.memory_bytes / (1024 * 1024));
                const diskMb = Math.round(res.resources.disk_bytes / (1024 * 1024));
                const cpuPercent = res.resources.cpu_absolute;
                const state = res.current_state;
                const c = ComponentsV2.baseContainer(state === 'running' ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);
                const cpuGauge = renderGaugeBar(cpuPercent);
                const text = `# 📊 Live Server Gauges: ${serverId}\n\n` +
                    `› **Power State:** \`${state.toUpperCase()}\`\n` +
                    `› **Uptime:** \`${Math.round(res.resources.uptime / 60)} minutes\`\n\n` +
                    `### 🎛️ Real-Time Telemetry Gauges\n` +
                    `› **CPU Load:** ${cpuGauge}\n` +
                    `› **RAM Memory:** \`${memoryMb} MB\` (${formatBytes(res.resources.memory_bytes)})\n` +
                    `› **Disk Storage:** \`${diskMb} MB\` (${formatBytes(res.resources.disk_bytes)})\n` +
                    `› **Network Traffic:** \`↓ ${formatBytes(res.resources.network_rx_bytes)} | ↑ ${formatBytes(res.resources.network_tx_bytes)}\`\n\n` +
                    `-# Live telemetry from Victus Cloud Pterodactyl daemon`;
                c.addTextDisplayComponents(ComponentsV2.text(text));
                await interaction.editReply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
                return;
            }
        }
        catch (err) {
            await interaction.editReply({ content: `❌ Operation failed: ${err.message}` });
        }
    },
};
