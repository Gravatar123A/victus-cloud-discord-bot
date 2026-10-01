import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    logChannelId: null,
    adminRoleIds: [],
    adminUserIds: [],
};
export class LeaveSettingsService {
    async getConfig(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_leave_settings');
            let raw = {};
            if (embed?.description)
                raw = JSON.parse(embed.description);
            return {
                logChannelId: raw.logChannelId ?? null,
                adminRoleIds: Array.isArray(raw.adminRoleIds) ? raw.adminRoleIds : [],
                adminUserIds: Array.isArray(raw.adminUserIds) ? raw.adminUserIds : [],
            };
        }
        catch (error) {
            logger.error(`Failed to get leave settings for guild ${guildId}:`, error);
            return { ...DEFAULT_CONFIG };
        }
    }
    async setConfig(guildId, updates) {
        const current = await this.getConfig(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_leave_settings', {
                description: JSON.stringify(updated),
            });
        }
        catch (error) {
            logger.error(`Failed to save leave settings for guild ${guildId}:`, error);
        }
        return updated;
    }
    async getApplications() {
        try {
            const embed = await supabase.getCustomEmbed('global', '_leave_applications');
            if (!embed?.description)
                return {};
            return JSON.parse(embed.description);
        }
        catch (error) {
            logger.error('Failed to load leave applications:', error);
            return {};
        }
    }
    async saveApplications(applications) {
        try {
            await supabase.saveCustomEmbed('global', '_leave_applications', {
                description: JSON.stringify(applications),
            });
        }
        catch (error) {
            logger.error('Failed to save leave applications:', error);
        }
    }
    async createApplication(application) {
        const applications = await this.getApplications();
        applications[application.id] = application;
        await this.saveApplications(applications);
    }
    async getApplication(id) {
        const applications = await this.getApplications();
        return applications[id] || null;
    }
    async updateApplication(id, updates) {
        const applications = await this.getApplications();
        if (!applications[id])
            return null;
        const updated = { ...applications[id], ...updates };
        applications[id] = updated;
        await this.saveApplications(applications);
        return updated;
    }
}
export const leaveSettings = new LeaveSettingsService();
