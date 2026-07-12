import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

// Minimal "just add the bot" invite. Community Coins only needs the Victus bot to
// be a *member* of the publisher's guild — membership is verified server-side by a
// Supabase edge function via `GET /guilds/{guild}/members/{user}`, which does not
// require any privileged gateway intent. So we intentionally request the smallest
// possible permission set (scope=bot) instead of the Administrator invite used
// elsewhere. The client id is env-driven (config.discord.clientId) to match the
// rest of the bot's invite links.
const COMMUNITY_COINS_INVITE =
    `https://discord.com/oauth2/authorize?client_id=${config.discord.clientId}&scope=bot&permissions=1`;

// Where publishers create their listing (Victus free panel → Community → Community Coins).
const PUBLISH_URL = config.branding.free;

export const communityCoinsCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('community-coins')
        .setDescription('Set up a Victus Community Coins listing so people who join this server earn COINS')
        .setDMPermission(false),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: EPH | V2 });

        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name ?? 'your server';

        if (!guildId) {
            await interaction.editReply({
                components: [
                    ComponentsV2.warningContainer(
                        'Run This In Your Server',
                        'Use `/community-coins` inside the Discord server you want to publish so I can read its **Server ID**.'
                    ),
                ],
                flags: V2,
            });
            return;
        }

        // Because this command ran inside the guild, the Victus bot is a confirmed
        // member here — which is the only hard requirement for join verification.
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
        container
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `-# 💠 VICTUS CLOUD CONNECTION • COMMUNITY COINS\n` +
                    `# Community Coins Listing Setup\n\n` +
                    `Publish **${guildName}** on Victus Cloud and reward visitors who join with **COINS**.\n\n` +
                    `### This server\n` +
                    `› **Server ID:** \`${guildId}\`\n` +
                    `› **Victus bot present:** ✅ Yes — this command ran here.\n` +
                    `› **Join verification:** ✅ Ready — Victus checks membership server-side, so no extra permissions or intents are needed.\n\n` +
                    `### Publish in 4 steps\n` +
                    `**1.** You've already added the Victus bot ✅\n` +
                    `**2.** Copy this Server ID: \`${guildId}\`\n` +
                    `**3.** Open the Victus **free panel → Community → Community Coins → Publish** and paste the ID.\n` +
                    `**4.** Set your COINS reward — visitors who join **${guildName}** earn it automatically.`
                )
            )
            .addSeparatorComponents(ComponentsV2.separator())
            .addActionRowComponents(
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setLabel('Add Victus Bot')
                        .setStyle(ButtonStyle.Link)
                        .setURL(COMMUNITY_COINS_INVITE),
                    new ButtonBuilder()
                        .setLabel('Open Free Panel')
                        .setStyle(ButtonStyle.Link)
                        .setURL(PUBLISH_URL),
                    new ButtonBuilder()
                        .setLabel('Victus Cloud')
                        .setStyle(ButtonStyle.Link)
                        .setURL(config.branding.website)
                )
            )
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `-# Keep the Victus bot in your server so joins can be verified — removing it disables COINS payouts.`
                )
            );

        await interaction.editReply({
            components: [container],
            flags: V2,
        });
    },
};
