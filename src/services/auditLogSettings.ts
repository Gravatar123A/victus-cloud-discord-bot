import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface AuditLogConfig {
    enabled: boolean;
    channelId: string | null;
    events: string[];
}

const DEFAULT_CONFIG: AuditLogConfig = {
    enabled: false,
    channelId: null,
    events: ['message_edit', 'message_delete', 'member_join', 'member_leave', 'ban', 'unban']
};

export class AuditLogSettingsService {
    async get(guildId: string): Promise<AuditLogConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_audit_log_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw
            };
        } catch (error) {
            logger.error(`Failed to get audit log settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<AuditLogConfig>): Promise<AuditLogConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_audit_log_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save audit log settings for guild ${guildId}:`, error);
        }
        return updated;
    }
}

export const auditLogSettings = new AuditLogSettingsService();
