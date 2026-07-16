import { Events, EmbedBuilder } from 'discord.js';
import type { GuildMember, PartialGuildMember } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';
import { config as botConfig } from '../config.js';
import { supabase } from '../services/supabase.js';

/**
 * If the leaving member has a PENDING invite credit, void it — they left before
 * qualifying, so the inviter is never paid (the clean anti-farm path; no COINS
 * were ever moved). A 'confirmed' credit is left untouched: in the escrow model
 * the 20 COINS are only paid after the qualifying period AND while still a
 * member, so there is nothing to claw back.
 */
async function voidInviteCreditOnLeave(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!botConfig.economy.invite.enabled) return;
    const supportGuildId = botConfig.bot.supportGuildId;
    if (supportGuildId && member.guild.id !== supportGuildId) return;

    const credit = await supabase.getInviteCreditByInvitee(member.id);
    if (!credit) return;

    const patch: Record<string, unknown> = {};
    if (!credit.left_at) patch.left_at = new Date().toISOString();
    if (credit.status === 'pending') patch.status = 'voided';

    if (Object.keys(patch).length > 0) {
        await supabase.updateInviteCredit(credit.id, patch);
        if (patch.status === 'voided') {
            logger.info(`Invite credit VOIDED: invitee ${member.id} left before qualifying (no COINS paid)`);
        }
    }
}

export const guildMemberRemoveEvent: Event = {
    name: Events.GuildMemberRemove,
    async execute(member: GuildMember) {
        // Void any pending invite credit first, isolated from the audit flow.
        await voidInviteCreditOnLeave(member).catch((error) => {
            logger.error('Error voiding invite credit on leave:', error);
        });

        try {
            const guildId = member.guild.id;
            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('member_leave')) return;

            const logChannel = member.guild.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const rolesStr = member.roles.cache
                .filter(role => role.name !== '@everyone')
                .map(role => `<@&${role.id}>`)
                .join(', ') || 'None';

            const joinedAt = member.joinedAt 
                ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:f> (<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>)`
                : 'Unknown';

            const embed = new EmbedBuilder()
                .setColor(0xef4444) // Red
                .setThumbnail(member.user.displayAvatarURL())
                .setAuthor({
                    name: member.user.tag,
                    iconURL: member.user.displayAvatarURL()
                })
                .setTitle('📤 Member Left')
                .setDescription(`**User:** <@${member.user.id}> (${member.user.username})\n**ID:** \`${member.user.id}\``)
                .addFields(
                    { name: 'Joined Guild At', value: joinedAt },
                    { name: 'Roles', value: rolesStr }
                )
                .setTimestamp();

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing guildMemberRemove event:', error);
        }
    }
};

export default guildMemberRemoveEvent;
