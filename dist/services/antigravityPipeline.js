import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { groqAi } from './groqAi.js';
import { conversationMemory } from './conversationMemory.js';
import { antigravityAgentApi } from './antigravityAgentApi.js';
import { antigravityBridge } from './antigravityBridge.js';
class AntigravityPipelineService {
    // In-memory mapping of Discord channel/thread ID -> Antigravity conversation ID & stats
    sessions = new Map();
    SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    // Track active runs per channel/thread to prevent concurrent conflicting runs
    runningTasks = new Set();
    constructor() {
        antigravityBridge.initBotListener().catch(() => { });
    }
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
        const existing = this.sessions.get(channelOrThreadId);
        this.sessions.set(channelOrThreadId, {
            conversationId,
            lastUpdated: Date.now(),
            turns: (existing?.turns || 0) + 1,
        });
    }
    /**
     * Clear the conversation session for a channel or thread
     */
    clearSession(channelOrThreadId) {
        this.sessions.delete(channelOrThreadId);
        conversationMemory.clear(channelOrThreadId).catch(() => { });
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
     * Resolve the agy executable path across platforms
     */
    getExecutablePath() {
        if (config.antigravity.agyPath && config.antigravity.agyPath !== 'agy') {
            return config.antigravity.agyPath;
        }
        // Common Linux / container locations
        const linuxPaths = [
            path.join(process.env.HOME || '/root', '.local', 'bin', 'agy'),
            '/usr/local/bin/agy',
            '/usr/bin/agy',
            '/home/container/.local/bin/agy',
        ];
        for (const lp of linuxPaths) {
            if (existsSync(lp))
                return lp;
        }
        // Common Windows locations
        const winPaths = [
            path.join(process.env.LOCALAPPDATA || 'C:\\Users\\User\\AppData\\Local', 'agy', 'bin', 'agy.exe'),
            'C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe',
        ];
        for (const wp of winPaths) {
            if (existsSync(wp))
                return wp;
        }
        // Dynamic PATH lookup
        try {
            const lookupCmd = process.platform === 'win32' ? 'where.exe agy' : 'which agy';
            const found = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
            if (found && existsSync(found))
                return found;
        }
        catch {
            // Not in PATH
        }
        return 'agy';
    }
    /**
     * Check if agy binary is available on the current host
     */
    isAgyAvailable() {
        const exe = this.getExecutablePath();
        if (path.isAbsolute(exe)) {
            return existsSync(exe);
        }
        try {
            const lookupCmd = process.platform === 'win32' ? 'where.exe agy' : 'which agy';
            execSync(lookupCmd, { stdio: 'ignore' });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Execute a task instruction with local agy engine or seamless Cloud AI fallback
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
            // 1. Try running with local Antigravity AgentAPI (spawns real sessions in Antigravity desktop app on this PC)
            if (antigravityAgentApi.isAvailable()) {
                logger.info(`[AntigravityPipeline] Executing via local Antigravity AgentAPI for @${userTag} in ${channelOrThreadId}. Conv: ${activeConvId || 'new'}`);
                try {
                    const localResult = await antigravityAgentApi.executeTurn({
                        prompt: fullPrompt,
                        activeConversationId: activeConvId && !activeConvId.startsWith('cloud-') ? activeConvId : undefined,
                        title: `[Discord /staffai] @${userTag}: ${prompt.slice(0, 40)}`,
                        userTag,
                        timeoutMs: config.antigravity.timeoutMs || 240000,
                    });
                    if (localResult.success && localResult.conversationId) {
                        this.setSession(channelOrThreadId, localResult.conversationId);
                    }
                    return localResult;
                }
                catch (agentErr) {
                    logger.warn('[AntigravityPipeline] Local AgentAPI execution failed, trying next runner:', agentErr?.message || agentErr);
                }
            }
            // 2. Try Workstation Bridge via Supabase Realtime (when running on remote cloud, relay task to user's PC)
            if (antigravityBridge.isWorkstationOnline()) {
                logger.info(`[AntigravityPipeline] Workstation Bridge is ONLINE. Relaying task to developer PC for @${userTag}...`);
                try {
                    const bridgeResult = await antigravityBridge.dispatchTask({
                        prompt: fullPrompt,
                        activeConversationId: activeConvId && !activeConvId.startsWith('cloud-') ? activeConvId : undefined,
                        title: `[Discord /staffai] @${userTag}: ${prompt.slice(0, 40)}`,
                        userTag,
                        timeoutMs: config.antigravity.timeoutMs || 240000,
                    });
                    if (bridgeResult.success && bridgeResult.conversationId) {
                        this.setSession(channelOrThreadId, bridgeResult.conversationId);
                    }
                    return bridgeResult;
                }
                catch (bridgeErr) {
                    logger.warn('[AntigravityPipeline] Workstation Bridge dispatch failed, falling back:', bridgeErr?.message || bridgeErr);
                }
            }
            // 3. Try running with agy if installed on host
            if (this.isAgyAvailable()) {
                try {
                    const agyExe = this.getExecutablePath();
                    const args = [
                        '--dangerously-skip-permissions',
                        '--output-format',
                        'json',
                        '-p',
                        fullPrompt,
                    ];
                    if (activeConvId && !activeConvId.startsWith('cloud-')) {
                        args.push('--conversation', activeConvId);
                    }
                    if (config.antigravity.model) {
                        args.push('--model', config.antigravity.model);
                    }
                    logger.info(`[AntigravityPipeline] Executing via agy binary (${agyExe}) for @${userTag} in ${channelOrThreadId}. Conv: ${activeConvId || 'new'}`);
                    const agyResult = await this.spawnAgyProcess(agyExe, args, config.antigravity.workdir);
                    if (agyResult.success) {
                        if (agyResult.conversationId) {
                            this.setSession(channelOrThreadId, agyResult.conversationId);
                        }
                        if (!agyResult.telemetry) {
                            agyResult.telemetry = {
                                model: `${config.antigravity.model || 'gemini-3.8-flash-high'} (Workstation Runner)`,
                                turns: this.sessions.get(channelOrThreadId)?.turns || 1,
                            };
                        }
                        return agyResult;
                    }
                    // If it failed due to spawn error (ENOENT), log and fall through to Cloud AI
                    if (agyResult.error && (agyResult.error.includes('ENOENT') || agyResult.error.includes('not found'))) {
                        logger.warn('[AntigravityPipeline] agy runner reported ENOENT. Attempting Cloud AI fallback...');
                    }
                    else {
                        return agyResult;
                    }
                }
                catch (agyErr) {
                    logger.warn('[AntigravityPipeline] agy execution threw error, falling back to Cloud AI runner:', agyErr);
                }
            }
            // 4. Cloud AI Fallback Engine
            if (groqAi.isEnabled()) {
                logger.info(`[AntigravityPipeline] Executing via Cloud AI runner for @${userTag} in ${channelOrThreadId}`);
                const startTime = Date.now();
                try {
                    const history = await conversationMemory.getHistory(channelOrThreadId, 6);
                    const attachmentSummary = attachments?.map((a) => ({
                        name: a.name || 'attachment',
                        url: a.url,
                    }));
                    const aiResponse = await groqAi.executeStaffTask(prompt, {
                        userTag,
                        history,
                        attachments: attachmentSummary,
                    });
                    await conversationMemory.addExchange(channelOrThreadId, prompt, aiResponse);
                    const { hasQuestions, questions } = this.extractQuestions(aiResponse);
                    const durationSeconds = (Date.now() - startTime) / 1000;
                    const cloudConvId = activeConvId?.startsWith('cloud-')
                        ? activeConvId
                        : `cloud-${channelOrThreadId}`;
                    this.setSession(channelOrThreadId, cloudConvId);
                    const currentSession = this.sessions.get(channelOrThreadId);
                    const turns = currentSession?.turns || 1;
                    let formattedResponse = aiResponse;
                    if (!antigravityBridge.isWorkstationOnline()) {
                        formattedResponse += `\n\n*(💡 Tip: To open tasks live in your PC's Antigravity desktop app, start the bridge on your computer: \`npm run antigravity:bridge\`)*`;
                    }
                    return {
                        success: true,
                        conversationId: cloudConvId,
                        response: formattedResponse,
                        durationSeconds,
                        numTurns: turns,
                        telemetry: {
                            model: `${config.ai.model} (Cloud AI Engine)`,
                            turns,
                        },
                        hasQuestions,
                        questions,
                    };
                }
                catch (cloudErr) {
                    logger.error('[AntigravityPipeline] Cloud AI execution failed:', cloudErr);
                    return {
                        success: false,
                        response: `Cloud AI execution encountered an error: ${cloudErr?.message || 'unknown error'}`,
                        hasQuestions: false,
                        error: cloudErr?.message || 'Cloud AI error',
                    };
                }
            }
            // 5. Neither Local AgentAPI, Workstation Bridge, agy nor Cloud AI is available
            return {
                success: false,
                response: '❌ **Antigravity Runner Unavailable**\n\n' +
                    `No active Antigravity runner was detected.\n\n` +
                    '**How to resolve:**\n' +
                    '1. **Open in PC Antigravity:** Run `npm run antigravity:bridge` on your computer to open sessions directly in your Antigravity desktop app.\n' +
                    '2. **Cloud AI:** Configure `AI_API_KEY` (or `OPENROUTER_API_KEY`) on the server.\n',
                hasQuestions: false,
                error: 'No runner available',
            };
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
            const isWin = process.platform === 'win32';
            const child = spawn(exe, args, {
                cwd,
                env: { ...process.env },
                windowsHide: true,
                shell: isWin && !path.isAbsolute(exe),
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
