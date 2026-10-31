import { fileURLToPath } from 'node:url';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, } from 'discord.js';
const SCREENSHOT_NAME = 'urlrequest-panel.png';
const SCREENSHOT_PATH = fileURLToPath(new URL(`../../assets/${SCREENSHOT_NAME}`, import.meta.url));
export function buildUrlRequestGuide() {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setAuthor({ name: 'Victus Cloud • Support Guide', iconURL: 'https://victuscloud.com/favicon.png' })
        .setTitle('🧭 Where to find your server URL')
        .setDescription('To help us look at the right server, please send **your server’s control-panel link** in this private support ticket.')
        .addFields({ name: '🖥️ 1  Open your server', value: 'Go to the Victus Control Panel and select the server you need help with.' }, { name: '🔗 2  Copy the address', value: 'Click the address bar at the very top of your browser. Copy the **full URL**. It should look like `https://control.victuscloud.com/server/your-server-id`.' }, { name: '💬 3  Send it here', value: 'Paste your own link into this **private ticket** so staff can identify the correct server.' }, { name: '📸 Screenshot example', value: 'The red arrow points to the browser address bar. The server ID shown in the picture is just an example—copy **your** link.' })
        .setImage(`attachment://${SCREENSHOT_NAME}`)
        .setFooter({ text: '🔒 Share the server link only with staff in a private ticket. Never share passwords or API keys.' });
    const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setLabel('Open Victus Control Panel')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL('https://control.victuscloud.com/'));
    return {
        embeds: [embed],
        files: [new AttachmentBuilder(SCREENSHOT_PATH, { name: SCREENSHOT_NAME })],
        components: [buttons],
        allowedMentions: { parse: [] },
    };
}
export const urlRequestCommand = {
    data: new SlashCommandBuilder()
        .setName('urlrequest')
        .setDescription('Ask a customer to share their Victus server panel URL')
        .setDMPermission(false),
    adminOnly: true,
    cooldown: 3,
    async execute(interaction) {
        await interaction.reply(buildUrlRequestGuide());
    },
};
