import { ChannelType } from 'discord.js';
import type { VoiceState, VoiceBasedChannel } from 'discord.js';
import type { Event } from '../types/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { awardVoiceXp } from '../services/activityXp.js';
import { j2cSettings } from '../services/j2cSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';

// In-memory voice XP tracking. One ticking timer per (guild, user) session that
// awards XP each full minute while the non-bot member remains connected to voice.
// Timers are cleared on leave/disconnect/move so nothing leaks.

interface VoiceSession {
    timer: NodeJS.Timeout;
}

const sessions = new Map<string, VoiceSession>();

function sessionKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

// A member counts as "active" if they aren't muted/deafened (self or server)
// and there is at least one other non-bot human in the channel.
function isActive(state: VoiceState): boolean {
    return Boolean(state.channel && !state.member?.user.bot);
}

function stopSession(guildId: string, userId: string): void {
    const key = sessionKey(guildId, userId);
    const session = sessions.get(key);
    if (session) {
        clearInterval(session.timer);
        sessions.delete(key);
    }
}

function startSession(guildId: string, userId: string): void {
    const key = sessionKey(guildId, userId);
    if (sessions.has(key)) return; // already ticking

    const timer = setInterval(() => {
        // Re-resolve live state each tick; only award when still active.
        const guild = currentGuild(guildId);
        const voice = guild?.voiceStates.cache.get(userId);
        if (!voice || !voice.channel) {
            stopSession(guildId, userId);
            return;
        }
        if (!isActive(voice)) return;
        void awardVoiceXp(userId, 1).catch(() => undefined);
    }, 60_000);

    // Don't keep the process alive solely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
    sessions.set(key, { timer });
}

// Resolve the guild from any tracked voice state for cleanup ticks. We capture
// the client off the first VoiceState we see and reuse it.
let clientRef: import('discord.js').Client | null = null;
function currentGuild(guildId: string) {
    return clientRef?.guilds.cache.get(guildId) ?? null;
}

/** Recover voice XP timers for members already connected when the bot restarts. */
export function restoreVoiceXpSessions(client: import('discord.js').Client): void {
    clientRef = client;
    for (const guild of client.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
            if (state.member?.user.bot || !state.channel) continue;
            startSession(guild.id, state.id);
        }
    }
}

export const voiceStateUpdateEvent: Event = {
    name: 'voiceStateUpdate',
    async execute(oldState: VoiceState, newState: VoiceState) {
        if (!clientRef) clientRef = newState.client;

        const guild = newState.guild ?? oldState.guild;
        if (guild) {
            try {
                const j2cConfig = await j2cSettings.get(guild.id);
                if (j2cConfig.enabled && j2cConfig.channelId) {
                    const member = newState.member ?? oldState.member;
                    
                    // 1. User joins the J2C trigger channel
                    if (newState.channelId === j2cConfig.channelId && member && !member.user.bot) {
                        const categoryId = j2cConfig.categoryId || newState.channel?.parentId || null;
                        const chanName = j2cConfig.nameFormat.replace(/{username}/g, member.user.username);
                        
                        // Create temporary voice channel
                        const tempChannel = await guild.channels.create({
                            name: chanName,
                            type: ChannelType.GuildVoice,
                            parent: categoryId || undefined,
                            permissionOverwrites: [
                                {
                                    id: member.id,
                                    allow: ['ManageChannels', 'MoveMembers', 'MuteMembers', 'DeafenMembers']
                                }
                            ]
                        });
                        
                        // Add to tracked list with ownerId
                        await j2cSettings.addTempChannel(tempChannel.id, member.id);
                        
                        // Send Voice Control Panel to the channel's text chat
                        try {
                            const { buildVoiceControlPanel } = await import('../commands/j2c.js');
                            const panel = buildVoiceControlPanel(member.id);
                            await (tempChannel as any).send({
                                components: [panel],
                                flags: ComponentsV2.IS_COMPONENTS_V2
                            });
                        } catch (err) {
                            logger.error('Failed to send voice control panel:', err);
                        }

                        // Send Direct Message (DM) to creator
                        try {
                            const dmContainer = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
                            dmContainer.addTextDisplayComponents(
                                ComponentsV2.text(
                                    `# 🎉 Voice Channel Created!\n\n` +
                                    `Your temporary voice channel **${chanName}** has been successfully created in **${guild.name}**!\n\n` +
                                    `### 🎙️ Manage Your Channel\n` +
                                    `Go to the voice channel's text chat to use the **Voice Control Panel** dropdown. You can lock/unlock, rename, limit, or mute/ban members in your channel.`
                                )
                            );
                            await member.send({
                                components: [dmContainer],
                                flags: ComponentsV2.IS_COMPONENTS_V2
                            }).catch(() => {});
                        } catch (dmErr) {
                            logger.debug(`Failed to DM member ${member.id} about VC creation:`, dmErr);
                        }

                        // Move member to the new voice channel
                        await member.voice.setChannel(tempChannel).catch(() => {});
                    }
                    
                    // 2. User leaves/moves from a channel (cleanup empty temporary channel)
                    const tempChannels = await j2cSettings.getTempChannels();
                    if (oldState.channelId && tempChannels.includes(oldState.channelId)) {
                        const oldChannel = oldState.channel;
                        if (oldChannel && oldChannel.members.size === 0) {
                            await oldChannel.delete().catch(() => {});
                            await j2cSettings.removeTempChannel(oldState.channelId);
                        }
                    }
                }
            } catch (error) {
                logger.error('Error executing J2C voice state update:', error);
            }
        }

        // XP disabled — make sure nothing is running and bail.
        if (config.economy.xpPerVoiceMinute <= 0) {
            if (newState.guild) stopSession(newState.guild.id, newState.id);
            return;
        }

        const member = newState.member ?? oldState.member;
        if (member?.user.bot) return;

        const guildId = newState.guild?.id ?? oldState.guild?.id;
        const userId = newState.id;
        if (!guildId) return;

        const inVoiceNow = !!newState.channel;

        try {
            if (inVoiceNow) {
                // Joined or moved/updated while in a voice channel — ensure a
                // ticking session exists (the tick itself gates on activity).
                startSession(guildId, userId);
            } else {
                // Left voice entirely — stop and clean up the timer.
                stopSession(guildId, userId);
            }
        } catch (error) {
            logger.warn('voiceStateUpdate handling failed:', error);
        }
    },
};
