import { 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function getCpuTicks() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }
    const total = user + nice + sys + idle + irq;
    return { idle, total };
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCpuUsagePercentage(): Promise<number> {
    const start = getCpuTicks();
    await delay(500);
    const end = getCpuTicks();

    const idleDifference = end.idle - start.idle;
    const totalDifference = end.total - start.total;

    if (totalDifference === 0) return 0;
    const activeDifference = totalDifference - idleDifference;
    return Math.max(0, Math.min(100, Math.round((activeDifference / totalDifference) * 100)));
}

async function getDiskUsage(): Promise<{ totalGb: number; usedGb: number; percent: number } | null> {
    try {
        if (os.platform() === 'win32') {
            // Simple fallback for Windows testing
            return { totalGb: 500, usedGb: 120, percent: 24 };
        }
        
        const { stdout } = await execAsync('df -k /');
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) return null;

        const parts = lines[1].replace(/\s+/g, ' ').split(' ');
        if (parts.length < 5) return null;

        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);
        const percent = parseInt(parts[4].replace('%', ''), 10);

        return {
            totalGb: Math.round(totalKb / 1024 / 1024),
            usedGb: Math.round(usedKb / 1024 / 1024),
            percent
        };
    } catch {
        return null;
    }
}

function makeProgressBar(percent: number, size = 15): string {
    const filled = Math.round((percent / 100) * size);
    const empty = size - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (24 * 3600));
    const h = Math.floor((seconds % (24 * 3600)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

async function buildStatsDashboard(): Promise<any> {
    const cpuUsage = await getCpuUsagePercentage();
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    const disk = await getDiskUsage();
    
    const uptimeSec = os.uptime();
    const loadAvg = os.loadavg();

    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);

    const desc = `# 🖥️ Victus Cloud VPS System Statistics\n` +
        `Live metrics and resource utilization of the hosting server.\n\n` +
        `### CPU Usage\n` +
        `\`${makeProgressBar(cpuUsage)}\` **${cpuUsage}%**\n` +
        `› **Cores:** ${os.cpus().length}x ${os.cpus()[0]?.model || 'Unknown'}\n` +
        `› **Load Averages:** \`${loadAvg[0].toFixed(2)}\`, \`${loadAvg[1].toFixed(2)}\`, \`${loadAvg[2].toFixed(2)}\`\n\n` +
        `### Memory Usage\n` +
        `\`${makeProgressBar(memPercent)}\` **${memPercent}%**\n` +
        `› **Used:** ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB / ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB\n\n` +
        (disk ? 
        `### Disk Storage\n` +
        `\`${makeProgressBar(disk.percent)}\` **${disk.percent}%**\n` +
        `› **Used:** ${disk.usedGb} GB / ${disk.totalGb} GB\n\n` : '') +
        `### System Info\n` +
        `› **OS Platform:** \`${os.platform()} (${os.release()})\`\n` +
        `› **Arch:** \`${os.arch()}\`\n` +
        `› **Server Uptime:** \`${formatUptime(uptimeSec)}\``;

    container.addTextDisplayComponents(ComponentsV2.text(desc))
        .addSeparatorComponents(ComponentsV2.separator());

    const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('vpsstats:refresh')
            .setLabel('Refresh Stats 🔄')
            .setStyle(ButtonStyle.Primary)
    );

    container.addActionRowComponents(refreshRow);
    return container;
}

export const vpsStatsCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('vpsstats')
        .setDescription('Display server resource statistics for the VPS')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const isPrefix = interaction.constructor.name === 'PrefixInteraction';

        if (isPrefix) {
            await interaction.deferReply();
            const cpuUsage = await getCpuUsagePercentage();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memPercent = Math.round((usedMem / totalMem) * 100);
            const disk = await getDiskUsage();
            const uptimeSec = os.uptime();
            const loadAvg = os.loadavg();

            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle('🖥️ Victus Cloud VPS System Statistics')
                .addFields(
                    { name: '💻 CPU Usage', value: `\`${makeProgressBar(cpuUsage)}\` **${cpuUsage}%**\n› Cores: ${os.cpus().length}x\n› Load: ${loadAvg[0].toFixed(2)}` },
                    { name: '💾 Memory Usage', value: `\`${makeProgressBar(memPercent)}\` **${memPercent}%**\n› Used: ${(usedMem / 1024 / 1024 / 1024).toFixed(2)} / ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB` }
                )
                .setTimestamp();

            if (disk) {
                embed.addFields({ name: '📁 Disk Storage', value: `\`${makeProgressBar(disk.percent)}\` **${disk.percent}%**\n› Used: ${disk.usedGb} / ${disk.totalGb} GB` });
            }

            embed.addFields({ name: 'ℹ️ System Info', value: `› OS: \`${os.platform()}\` | Arch: \`${os.arch()}\`\n› Uptime: \`${formatUptime(uptimeSec)}\`` });

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.deferReply({ flags: EPH });
            const dashboard = await buildStatsDashboard();
            await interaction.editReply({
                components: [dashboard],
                flags: V2 | EPH
            });
        }
    },

    async handleButton(interaction) {
        if (interaction.customId !== 'vpsstats:refresh') return;
        await interaction.deferUpdate();
        const dashboard = await buildStatsDashboard();
        await interaction.editReply({
            components: [dashboard],
            embeds: [], // Safe clearing legacy embeds
            flags: V2
        });
    }
};
