import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface StaffAppConfig {
    questions: string[];
    reviewerChannelId: string | null;
    staffRoleId: string | null;
}

export interface StaffSubmission {
    id: string;
    userId: string;
    userName: string;
    guildId: string;
    status: 'pending' | 'approved' | 'denied';
    answers: Array<{ question: string; answer: string }>;
    submittedAt: string;
    reviewerId?: string;
    reviewedAt?: string;
}

const SETTINGS_PATH = join(process.cwd(), 'data', 'staff-app-settings.json');
const SUBMISSIONS_PATH = join(process.cwd(), 'data', 'staff-submissions.json');

const DEFAULT_CONFIG: StaffAppConfig = {
    questions: [
        'How old are you?',
        'What is your timezone?',
        'Why do you want to join our staff team?',
        'What is your past staffing experience?'
    ],
    reviewerChannelId: null,
    staffRoleId: null
};

// --- Settings ---
async function readAllConfigs(): Promise<Record<string, StaffAppConfig>> {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, StaffAppConfig>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read staff app settings:', error);
        }
        return {};
    }
}

async function writeAllConfigs(configs: Record<string, StaffAppConfig>): Promise<void> {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

// --- Submissions ---
async function readAllSubmissions(): Promise<Record<string, StaffSubmission>> {
    try {
        const raw = await readFile(SUBMISSIONS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, StaffSubmission>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read staff submissions:', error);
        }
        return {};
    }
}

async function writeAllSubmissions(submissions: Record<string, StaffSubmission>): Promise<void> {
    await mkdir(dirname(SUBMISSIONS_PATH), { recursive: true });
    await writeFile(SUBMISSIONS_PATH, JSON.stringify(submissions, null, 2), 'utf8');
}

export class StaffAppSettingsService {
    async get(guildId: string): Promise<StaffAppConfig> {
        const configs = await readAllConfigs();
        return {
            ...DEFAULT_CONFIG,
            ...(configs[guildId] || {})
        };
    }

    async set(guildId: string, updates: Partial<StaffAppConfig>): Promise<StaffAppConfig> {
        const configs = await readAllConfigs();
        const current = {
            ...DEFAULT_CONFIG,
            ...(configs[guildId] || {})
        };
        const updated = { ...current, ...updates };
        configs[guildId] = updated;
        await writeAllConfigs(configs);
        return updated;
    }

    async createSubmission(submission: StaffSubmission): Promise<void> {
        const submissions = await readAllSubmissions();
        submissions[submission.id] = submission;
        await writeAllSubmissions(submissions);
    }

    async getSubmission(id: string): Promise<StaffSubmission | null> {
        const submissions = await readAllSubmissions();
        return submissions[id] || null;
    }

    async updateSubmission(id: string, updates: Partial<StaffSubmission>): Promise<StaffSubmission | null> {
        const submissions = await readAllSubmissions();
        if (!submissions[id]) return null;
        const updated = { ...submissions[id], ...updates };
        submissions[id] = updated as StaffSubmission;
        await writeAllSubmissions(submissions);
        return updated as StaffSubmission;
    }
}

export const staffAppSettings = new StaffAppSettingsService();
