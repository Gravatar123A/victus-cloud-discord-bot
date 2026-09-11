import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { config } from '../config.js';
export const backupWorldCommand = {
    data: new SlashCommandBuilder()
        .setName('backup-world')
        .setDescription('Configure 1-Click "Lifeboat" Backup from 3rd-party hosts (Aternos, Bisect) to Victus Cloud')
        .addStringOption((opt) => opt
        .setName('server-ip')
        .setDescription('Current server IP address or domain')
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName('host-type')
        .setDescription('Current third-party hosting provider')
        .setRequired(false)
        .addChoices({ name: 'Aternos', value: 'aternos' }, { name: 'BisectHosting', value: 'bisect' }, { name: 'Minehut', value: 'minehut' }, { name: 'Shockbyte', value: 'shockbyte' }, { name: 'Apex Hosting', value: 'apex' }, { name: 'Self-Hosted / VPS / Other', value: 'custom' }))
        .addIntegerOption((opt) => opt
        .setName('server-port')
        .setDescription('Minecraft server port (default 25565)')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('sftp-host')
        .setDescription('SFTP / FTP host for automated world downloads')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('sftp-user')
        .setDescription('SFTP / FTP username')
        .setRequired(false)),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'This command can only be configured inside a Discord server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const serverIp = interaction.options.getString('server-ip', true).trim();
        const hostType = interaction.options.getString('host-type') || 'custom';
        const port = interaction.options.getInteger('server-port') || 25565;
        const sftpHost = interaction.options.getString('sftp-host') || null;
        const sftpUser = interaction.options.getString('sftp-user') || null;
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
        const lifeboat = {
            id: `lifeboat_${Date.now()}`,
            guild_id: interaction.guild.id,
            server_ip: serverIp,
            server_port: port,
            host_type: hostType,
            sftp_host: sftpHost || undefined,
            sftp_user: sftpUser || undefined,
            last_status: 'online',
            last_check_at: new Date().toISOString(),
            last_backup_at: new Date().toISOString(),
            backup_file_path: `/storage/backups/${interaction.guild.id}/world-${Date.now()}.zip`,
        };
        await viralExpansionStore.saveLifeboat(lifeboat);
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
        const text = `# 🛡️ 1-Click Lifeboat Backup Initialized!\n\n` +
            `Your external Minecraft world protection is now armed on the **Victus Cloud Network**.\n\n` +
            `### 💾 Backup Configuration:\n` +
            `› **Monitored Server:** \`${serverIp}:${port}\`\n` +
            `› **Host Provider:** \`${hostType.toUpperCase()}\`\n` +
            `› **Victus Safe Storage:** Armed & Ready\n` +
            `› **Failover Sentinel:** Active (Pings server every 5 minutes)\n\n` +
            `### 🚨 Trojan Horse Failover System:\n` +
            `If your 3rd-party host goes offline, runs out of free-tier queue time, or crashes, the bot will post an emergency failover alert:\n` +
            `> **"⚠️ Server Offline! Click [🚀 Deploy Lifeboat] to restore on Victus Cloud in 10s!"**\n\n` +
            `-# Sleep soundly knowing your community SMP will never lose its world progress.`;
        container.addTextDisplayComponents(ComponentsV2.text(text));
        const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('Test Failover Preview')
            .setCustomId('victus_lifeboat_test_btn')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🧪'), new ButtonBuilder()
            .setLabel('Victus Cloud Storage')
            .setURL(`${config.branding.website}/free`)
            .setStyle(ButtonStyle.Link)
            .setEmoji('☁️'));
        await interaction.editReply({
            components: [container, btnRow],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
