import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { assignLinkedRole } from '../utils/roles.js';
import { syncEntitlementRoles } from '../services/entitlementRoles.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';
import { logger } from '../utils/logger.js';

export const manualDcLinkCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('manualdclink')
        .setDescription('Manually link a Discord user to a Victus Cloud account (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((opt) =>
            opt.setName('user').setDescription('Discord user to link').setRequired(true)
        )
        .addStringOption((opt) =>
            opt.setName('email').setDescription('Victus Cloud email (exact, case-insensitive)').setRequired(true)
        ),
    adminOnly: true,
    cooldown: 5,
    async execute(interaction) {
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const discordUser = interaction.options.getUser('user', true);
        const rawEmail = interaction.options.getString('email', true);
        const email = rawEmail.trim().toLowerCase();

        if (!email.includes('@') || !email.includes('.')) {
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Invalid Email', `"\`${rawEmail}\`"` + ' does not look like a valid email.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 1) Find Victus profile by email (case-insensitive)
        const { data: profile, error: profileErr } = await supabase.client
            .from('profiles')
            .select('id, email')
            .ilike('email', email)
            .maybeSingle();

        if (profileErr) {
            logger.error('manualdclink profile lookup failed:', profileErr);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Lookup Failed', `Could not look up Victus account for \`${email}\`: ${profileErr.message}`)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        if (!profile) {
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Not Found', `No Victus Cloud account found for email \`${email}\`. Ask the user to verify the email in their Victus panel → Account.`)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        const targetUserId = String((profile as any).id);
        const targetEmail = String((profile as any).email || email);

        // 2) Check if this Discord user already linked
        const existingDiscord = await supabase.getLinkedAccount(discordUser.id);
        if (existingDiscord) {
            await interaction.editReply({
                components: [ComponentsV2.warningContainer(
                    'Already Linked',
                    `<@${discordUser.id}> is already linked to Victus user \`${existingDiscord.user_id}\`.\nUse \`/admin unlink\` or \`/unlink\` as that user first if you need to re-link.`
                )],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 3) Check if this Victus user already linked to another Discord
        const existingVictus = await supabase.getLinkedAccountByUserId(targetUserId);
        if (existingVictus) {
            await interaction.editReply({
                components: [ComponentsV2.warningContainer(
                    'Victus Account Already Linked',
                    `Victus account \`${targetEmail}\` is already linked to <@${existingVictus.discord_id}> (\`${existingVictus.discord_id}\`). Unlink it first with \`/admin unlink\`.`
                )],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 4) Insert link directly (bypasses token flow)
        const { error: insertErr } = await supabase.client.from('discord_linked_accounts').insert({
            user_id: targetUserId,
            discord_id: discordUser.id,
            discord_username: discordUser.tag ?? discordUser.username,
        });

        if (insertErr) {
            // Unique violation (race) — surface friendly
            if (String(insertErr.code) === '23505' || insertErr.message?.toLowerCase().includes('duplicate')) {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('Already Linked', 'That Discord user or Victus account was just linked by someone else. Refresh and try again.')],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }
            logger.error('manualdclink insert failed:', insertErr);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Link Failed', `Could not create link: ${insertErr.message}`)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 5) Post-link side effects (best-effort, never fail the command)
        const linked = { user_id: targetUserId, discord_id: discordUser.id };
        try { await assignLinkedRole(interaction.client, discordUser.id); } catch (e) { logger.warn(`manualdclink assignLinkedRole failed for ${discordUser.id}:`, e); }
        try { await syncEntitlementRoles(interaction.client, discordUser.id); } catch (e) { logger.warn(`manualdclink syncEntitlementRoles failed for ${discordUser.id}:`, e); }
        try { await supabase.grantDiscordLinkCoins(linked as any); } catch (e) { logger.warn(`manualdclink grantDiscordLinkCoins failed for ${discordUser.id}:`, e); }

        const success = ComponentsV2.successContainer(
            'Manually Linked',
            `Linked <@${discordUser.id}> (\`${discordUser.tag ?? discordUser.username}\`) → Victus \`${targetEmail}\` (\`${targetUserId}\`)\n\n` +
            `Role + 100 COINS (if enabled) granted where applicable. The user can now use linked commands.`
        );
        await interaction.editReply({ components: [success], flags: ComponentsV2.IS_COMPONENTS_V2 });

        try {
            await sendNotificationDM(
                interaction.client,
                discordUser.id,
                ComponentsV2.successContainer('Account Linked by Admin', `Your Discord account was manually linked to Victus Cloud \`${targetEmail}\` by an admin. You now have access to linked commands!`),
                'security'
            );
        } catch {}

        if (interaction.guildId) {
            await sendAuditLog(
                interaction.client,
                interaction.guildId,
                'Account Manually Linked',
                `**Admin:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n**Discord:** <@${discordUser.id}> (\`${discordUser.id}\`)\n**Victus:** \`${targetEmail}\` (\`${targetUserId}\`)`,
                ComponentsV2.Accents.success
            ).catch(() => {});
        }

        logger.info(`manualdclink: ${interaction.user.tag} linked ${discordUser.id} -> ${targetUserId} (${targetEmail})`);
    },
};
