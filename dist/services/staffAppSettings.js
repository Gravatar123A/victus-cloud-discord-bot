import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
export class StaffAppSettingsService {
    async get(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_staff_app_settings');
            let raw = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            // Migrate legacy single-category config to the categories model
            if (raw && !raw.categories) {
                const legacyQuestions = raw.questions || [
                    'How old are you?',
                    'What is your timezone?',
                    'Why do you want to join our staff team?',
                    'What is your past staffing experience?'
                ];
                const legacyRole = raw.staffRoleId || null;
                const legacyChannel = raw.reviewerChannelId || null;
                return {
                    categories: {
                        support: {
                            id: 'support',
                            displayName: 'Support Staff',
                            description: 'Help assist clients with tickets, billing and hosting queries.',
                            questions: legacyQuestions,
                            staffRoleId: legacyRole,
                            reviewerChannelId: legacyChannel
                        }
                    }
                };
            }
            return {
                categories: raw.categories || {}
            };
        }
        catch (error) {
            logger.error(`Failed to get staff app settings for guild ${guildId}:`, error);
            return { categories: {} };
        }
    }
    async set(guildId, updates) {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_staff_app_settings', {
                description: JSON.stringify(updated)
            });
        }
        catch (error) {
            logger.error(`Failed to save staff app settings for guild ${guildId}:`, error);
        }
        return updated;
    }
    async getSubmissions() {
        try {
            const embed = await supabase.getCustomEmbed('global', '_staff_submissions');
            if (!embed?.description)
                return {};
            return JSON.parse(embed.description);
        }
        catch (error) {
            logger.error('Failed to get staff submissions from database:', error);
            return {};
        }
    }
    async saveSubmissions(submissions) {
        try {
            await supabase.saveCustomEmbed('global', '_staff_submissions', {
                description: JSON.stringify(submissions)
            });
        }
        catch (error) {
            logger.error('Failed to save staff submissions to database:', error);
        }
    }
    async createSubmission(submission) {
        const submissions = await this.getSubmissions();
        submissions[submission.id] = submission;
        await this.saveSubmissions(submissions);
    }
    async getSubmission(id) {
        const submissions = await this.getSubmissions();
        return submissions[id] || null;
    }
    async updateSubmission(id, updates) {
        const submissions = await this.getSubmissions();
        if (!submissions[id])
            return null;
        const updated = { ...submissions[id], ...updates };
        submissions[id] = updated;
        await this.saveSubmissions(submissions);
        return updated;
    }
}
export const staffAppSettings = new StaffAppSettingsService();
