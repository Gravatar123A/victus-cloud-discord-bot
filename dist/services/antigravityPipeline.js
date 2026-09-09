import { spawn } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
class AntigravityPipelineService {
    // In-memory mapping of Discord channel/thread ID -> Antigravity conversation ID
    sessions = new Map();
    SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    // Track active runs per channel/thread to prevent concurrent conflicting runs
    runningTasks = new Set();
    /**
     * Check if a GuildMember has permission to run staff Antigravity commands
     */
    isAuthorized(member) {
        if (!member)
            return false;
        // Server owner and admins always authorized
        if (member.id === member.guild.ownerId)
            return true;
        if (member.permissions.has(PermissionFlagsBits.Administrator))
            return true;
        if (member.permissions.has(PermissionFlagsBits.ManageGuild))
            return true;
        // Configured staff role IDs
        const staffRoles = config.antigravity.staffRoleIds;
        if (staffRoles.length > 0) {
            return staffRoles.some((roleId) => member.roles.cache.has(roleId));
        }
        return false;
    }
    /**
     * Get the active Antigravity conversation ID for a given channel or thread
     */
    getSession(channelOrThreadId) {
        const session = this.sessions.get(channelOrThreadId);
        if (!session)
            return undefined;
        if (Date.now() - session.lastUpdated > this.SESSION_TTL_MS) {
            this.sessions.delete(channelOrThreadId);
            return undefined;
        }
        return session.conversationId;
    }
    /**
     * Set or update an active conversation ID for a channel or thread
     */
    setSession(channelOrThreadId, conversationId) {
        this.sessions.set(channelOrThreadId, {
            conversationId,
            lastUpdated: Date.now(),
        });
    }
    /**
     * Clear the conversation session for a channel or thread
     */
    clearSession(channelOrThreadId) {
        this.sessions.delete(channelOrThreadId);
    }
    /**
     * Check if a task is currently executing in a given channel or thread
     */
    isTaskRunning(channelOrThreadId) {
        return this.runningTasks.has(channelOrThreadId);
    }
    /**
     * Download an attachment safely to the local temp directory
     */
    async saveAttachmentLocally(attachment) {
        const tempBaseDir = path.resolve(config.antigravity.workdir, '.antigravity_discord', 'attachments');
        if (!existsSync(tempBaseDir)) {
            mkdirSync(tempBaseDir, { recursive: true });
        }
        const safeFilename = `${Date.now()}_${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const localPath = path.join(tempBaseDir, safeFilename);
        const response = await fetch(attachment.url);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download attachment ${attachment.name}: ${response.statusText}`);
        }
        await pipeline(response.body, createWriteStream(localPath));
        return localPath;
    }
    /**
     * Resolve the agy executable path
     */
    getExecutablePath() {
        if (config.antigravity.agyPath && config.antigravity.agyPath !== 'agy') {
            return config.antigravity.agyPath;
        }
        const defaultWinPath = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\User\\AppData\\Local', 'agy', 'bin', 'agy.exe');
        if (existsSync(defaultWinPath)) {
            return defaultWinPath;
        }
        return 'agy';
    }
    /**
     * Execute a task instruction through the local Antigravity CLI
     */
    async executeTask(options) {
        const { prompt, userId, userTag, channelOrThreadId, attachments, forceNewSession } = options;
        if (this.runningTasks.has(channelOrThreadId)) {
            return {
                success: false,
                response: 'A task is already actively running in this thread/channel. Please wait for it to complete.',
                hasQuestions: false,
                error: 'Concurrent task execution blocked',
            };
        }
        this.runningTasks.add(channelOrThreadId);
        try {
            // Process attachments if any
            const attachmentNotes = [];
            if (attachments && attachments.length > 0) {
                for (const att of attachments) {
                    try {
                        const localPath = await this.saveAttachmentLocally(att);
                        attachmentNotes.push(`- File: "${att.name}" (${att.contentType || 'unknown'}) saved at: "${localPath.replace(/\\/g, '/')}"`);
                    }
                    catch (err) {
                        logger.warn(`Failed to cache attachment ${att.name}:`, err);
                        attachmentNotes.push(`- File: "${att.name}" (Failed to download: ${err?.message})`);
                    }
                }
            }
            // Build comprehensive prompt with Discord staff context
            let fullPrompt = `[DISCORD STAFF WORK INSTRUCTION]\nFrom: @${userTag} (ID: ${userId})\n`;
            if (attachmentNotes.length > 0) {
                fullPrompt += `Attachments provided:\n${attachmentNotes.join('\n')}\n(You can inspect any image/file using view_file).\n\n`;
            }
            fullPrompt += `Staff Task / Instructions:\n${prompt}\n\n`;
            fullPrompt += `[System Instruction: If you need clarification, more requirements, or have specific questions for the staff before or after acting, clearly separate them under a heading '### ❓ Questions for Staff'.]`;
            // Session continuity
            let activeConvId = forceNewSession ? undefined : this.getSession(channelOrThreadId);
            if (forceNewSession) {
                this.clearSession(channelOrThreadId);
            }
            const agyExe = this.getExecutablePath();
            const args = [
                '--dangerously-skip-permissions',
                '--output-format',
                'json',
                '-p',
                fullPrompt,
            ];
            if (activeConvId) {
                args.push('--conversation', activeConvId);
            }
            if (config.antigravity.model) {
                args.push('--model', config.antigravity.model);
            }
            logger.info(`[AntigravityPipeline] Running task for user ${userTag} in ${channelOrThreadId}. Conv: ${activeConvId || 'new'}`);
            const result = await this.spawnAgyProcess(agyExe, args, config.antigravity.workdir);
            if (result.success && result.conversationId) {
                this.setSession(channelOrThreadId, result.conversationId);
            }
            return result;
        }
        finally {
            this.runningTasks.delete(channelOrThreadId);
        }
    }
    /**
     * Spawn the agy process and capture output
     */
    spawnAgyProcess(exe, args, cwd) {
        return new Promise((resolve) => {
            const timeoutMs = config.antigravity.timeoutMs || 300000;
            let stdoutData = '';
            let stderrData = '';
            let isTimedOut = false;
            const child = spawn(exe, args, {
                cwd,
                env: { ...process.env },
                windowsHide: true,
            });
            const timer = setTimeout(() => {
                isTimedOut = true;
                try {
                    child.kill('SIGTERM');
                }
                catch {
                    // Ignore kill errors
                }
                resolve({
                    success: false,
                    response: `Execution timed out after ${Math.round(timeoutMs / 1000)}s. The task was terminated.`,
                    hasQuestions: false,
                    error: 'Execution timeout',
                });
            }, timeoutMs);
            child.stdout.on('data', (data) => {
                stdoutData += data.toString('utf-8');
            });
            child.stderr.on('data', (data) => {
                stderrData += data.toString('utf-8');
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                if (isTimedOut)
                    return;
                logger.error('[AntigravityPipeline] Failed to spawn agy process:', err);
                resolve({
                    success: false,
                    response: `Failed to launch Antigravity runner: ${err.message}`,
                    hasQuestions: false,
                    error: err.message,
                });
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (isTimedOut)
                    return;
                if (code !== 0 && !stdoutData.trim()) {
                    logger.error(`[AntigravityPipeline] Process exited with code ${code}. Stderr: ${stderrData}`);
                    return resolve({
                        success: false,
                        response: stderrData.trim() || `Antigravity CLI exited with error code ${code}.`,
                        hasQuestions: false,
                        error: `Exit code ${code}`,
                        rawOutput: stderrData,
                    });
                }
                // Parse the JSON output from agy
                try {
                    const trimmed = stdoutData.trim();
                    let jsonStr = trimmed;
                    const jsonStart = trimmed.indexOf('{');
                    const jsonEnd = trimmed.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                        jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
                    }
                    const parsed = JSON.parse(jsonStr);
                    const responseText = parsed.response || parsed.content || trimmed;
                    const { hasQuestions, questions } = this.extractQuestions(responseText);
                    resolve({
                        success: true,
                        conversationId: parsed.conversation_id,
                        response: responseText,
                        durationSeconds: parsed.duration_seconds,
                        numTurns: parsed.num_turns,
                        usage: parsed.usage,
                        hasQuestions,
                        questions,
                        rawOutput: trimmed,
                    });
                }
                catch (parseError) {
                    logger.warn('[AntigravityPipeline] Could not parse JSON output, returning raw text:', parseError);
                    const raw = stdoutData.trim() || stderrData.trim();
                    const { hasQuestions, questions } = this.extractQuestions(raw);
                    resolve({
                        success: code === 0,
                        response: raw || 'Antigravity completed execution without textual output.',
                        hasQuestions,
                        questions,
                        rawOutput: raw,
                    });
                }
            });
        });
    }
    /**
     * Detect if Antigravity output contains questions for staff
     */
    extractQuestions(text) {
        if (!text)
            return { hasQuestions: false };
        const questionsPattern = /###\s*❓\s*Questions\s*(?:for\s*Staff)?([\s\S]*?)(?:###|$)/i;
        const match = text.match(questionsPattern);
        if (match && match[1]) {
            const rawQuestions = match[1]
                .split('\n')
                .map((q) => q.trim().replace(/^[-*•]\s*/, ''))
                .filter((q) => q.length > 5);
            return {
                hasQuestions: true,
                questions: rawQuestions.length > 0 ? rawQuestions : [match[1].trim()],
            };
        }
        const questionLines = text
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => (l.startsWith('?') || l.endsWith('?')) && l.length > 15 && !l.startsWith('```'));
        if (questionLines.length > 0 && (text.includes('clarify') || text.includes('confirm') || text.includes('should I'))) {
            return {
                hasQuestions: true,
                questions: questionLines.slice(0, 3),
            };
        }
        return { hasQuestions: false };
    }
}
export const antigravityPipeline = new AntigravityPipelineService();
