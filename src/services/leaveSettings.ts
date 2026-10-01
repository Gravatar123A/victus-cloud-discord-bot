import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Apply-For-Leave (AFL) persistence.
 *
 * Config is stored per guild as a custom embed, applications are stored in a
 * single global blob keyed by a short id — the same lightweight pattern used by
 * the staff application system, so no new tables are required.
 */

export interface LeaveConfig {
    logChannelId: string | null;
    adminRoleIds: string[];
    adminUserIds: string[];
}

export interface LeaveApplication {
    id: string;
    guildId: string;
    channelId: string | null;
    messageId: string | null;
    userId: string;
    userName: string;
    name: string;
    role: string;
    reason: string;
    days: string;
    status: 'pending' | 'approved' | 'rejected';
    submittedAt: string;
    reviewedBy?: string;
    reviewedAt?: string;
    decisionReason?: string;
}

const DEFAULT_CONFIG: LeaveConfig = {
    logChannelId: null,
    adminRoleIds: [],
    adminUserIds: [],
};

export class LeaveSettingsService {
    async getConfig(guildId: string): Promise<LeaveConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_leave_settings');
            let raw: any = {};
            if (embed?.description) raw = JSON.parse(embed.description);
            return {
                logChannelId: raw.logChannelId ?? null,
                adminRoleIds: Array.isArray(raw.adminRoleIds) ? raw.adminRoleIds : [],
                adminUserIds: Array.isArray(raw.adminUserIds) ? raw.adminUserIds : [],
            };
        } catch (error) {
            logger.error(`Failed to get leave settings for guild ${guildId}:`, error);
            return { ...DEFAULT_CONFIG };
        }
    }

    async setConfig(guildId: string, updates: Partial<LeaveConfig>): Promise<LeaveConfig> {
        const current = await this.getConfig(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_leave_settings', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.error(`Failed to save leave settings for guild ${guildId}:`, error);
        }
        return updated;
    }

    async getApplications(): Promise<Record<string, LeaveApplication>> {
        try {
            const embed = await supabase.getCustomEmbed('global', '_leave_applications');
            if (!embed?.description) return {};
            return JSON.parse(embed.description) as Record<string, LeaveApplication>;
        } catch (error) {
            logger.error('Failed to load leave applications:', error);
            return {};
        }
    }

    async saveApplications(applications: Record<string, LeaveApplication>): Promise<void> {
        try {
            await supabase.saveCustomEmbed('global', '_leave_applications', {
                description: JSON.stringify(applications),
            });
        } catch (error) {
            logger.error('Failed to save leave applications:', error);
        }
    }

    async createApplication(application: LeaveApplication): Promise<void> {
        const applications = await this.getApplications();
        applications[application.id] = application;
        await this.saveApplications(applications);
    }

    async getApplication(id: string): Promise<LeaveApplication | null> {
        const applications = await this.getApplications();
        return applications[id] || null;
    }

    async updateApplication(id: string, updates: Partial<LeaveApplication>): Promise<LeaveApplication | null> {
        const applications = await this.getApplications();
        if (!applications[id]) return null;
        const updated = { ...applications[id], ...updates } as LeaveApplication;
        applications[id] = updated;
        await this.saveApplications(applications);
        return updated;
    }
}

export const leaveSettings = new LeaveSettingsService();
