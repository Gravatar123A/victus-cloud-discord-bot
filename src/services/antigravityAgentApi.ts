import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import type { AntigravityResult } from './antigravityPipeline.js';

const execAsync = promisify(exec);

export class AntigravityAgentApiService {
    private agentApiBatPath: string | null = null;

    /**
     * Locate the agentapi executable on the host
     */
    public getExecutablePath(): string | null {
        if (this.agentApiBatPath && fs.existsSync(this.agentApiBatPath)) {
            return this.agentApiBatPath;
        }

        const candidates = [
            path.join(process.env.USERPROFILE || 'C:\\Users\\User', '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
            'C:\\Users\\User\\.gemini\\antigravity\\bin\\agentapi.bat',
            path.join(process.env.HOME || '/root', '.gemini', 'antigravity', 'bin', 'agentapi'),
            path.join(process.env.LOCALAPPDATA || 'C:\\Users\\User\\AppData\\Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                this.agentApiBatPath = candidate;
                return candidate;
            }
        }

        return null;
    }

    /**
     * Check if agentapi is available on this machine
     */
    public isAvailable(): boolean {
        return this.getExecutablePath() !== null;
    }

    /**
     * Get the base brain directory where Antigravity saves conversation logs and artifacts
     */
    public getBrainDir(): string {
        const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\User';
        return path.join(home, '.gemini', 'antigravity', 'brain');
    }

    /**
     * Start a new conversation inside the Antigravity desktop app
     */
    public async startConversation(
        title: string,
        prompt: string,
        model = 'flash'
    ): Promise<string> {
        const exe = this.getExecutablePath();
        if (!exe) {
            throw new Error('agentapi executable not found on this machine');
        }

        const safeTitle = title.replace(/["\r\n]/g, ' ').slice(0, 80);
        // Escape prompt safely for command line
        const escapedPrompt = prompt.replace(/"/g, '""');

        const cmd = `"${exe}" new-conversation --title="${safeTitle}" "${escapedPrompt}"`;
        logger.info(`[AgentAPI] Starting new Antigravity desktop session: "${safeTitle}"`);

        const { stdout } = await execAsync(cmd, {
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });

        const parsed = JSON.parse(stdout.trim());
        const convId = parsed?.response?.newConversation?.conversationId;

        if (!convId) {
            throw new Error(`Failed to extract conversationId from agentapi stdout: ${stdout}`);
        }

        logger.info(`[AgentAPI] Desktop session spawned with ID: ${convId}`);
        return convId;
    }

    /**
     * Send a follow-up turn into an existing Antigravity desktop conversation
     */
    public async sendMessage(conversationId: string, prompt: string): Promise<void> {
        const exe = this.getExecutablePath();
        if (!exe) {
            throw new Error('agentapi executable not found on this machine');
        }

        const escapedPrompt = prompt.replace(/"/g, '""');
        const cmd = `"${exe}" send-message "${conversationId}" "${escapedPrompt}"`;
        logger.info(`[AgentAPI] Sending turn to Antigravity desktop session: ${conversationId}`);

        await execAsync(cmd, {
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });
    }

    /**
     * Watch transcript.jsonl until the agent finishes its response
     */
    public async waitForCompletion(
        conversationId: string,
        initialLineCount: number,
        timeoutMs = 180000
    ): Promise<{
        response: string;
        durationSeconds: number;
        thinking?: string;
        numTurns: number;
    }> {
        const transcriptPath = path.join(
            this.getBrainDir(),
            conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl'
        );

        const startTime = Date.now();
        const pollIntervalMs = 400;

        while (Date.now() - startTime < timeoutMs) {
            if (fs.existsSync(transcriptPath)) {
                try {
                    const raw = fs.readFileSync(transcriptPath, 'utf8');
                    const lines = raw.trim().split('\n').filter(Boolean);

                    if (lines.length > initialLineCount) {
                        for (let i = lines.length - 1; i >= initialLineCount; i--) {
                            try {
                                const entry = JSON.parse(lines[i]);
                                if (
                                    entry.type === 'PLANNER_RESPONSE' &&
                                    entry.status === 'DONE' &&
                                    typeof entry.content === 'string' &&
                                    entry.content.trim().length > 0 &&
                                    !entry.tool_calls
                                ) {
                                    const durationSeconds = (Date.now() - startTime) / 1000;
                                    return {
                                        response: entry.content.trim(),
                                        durationSeconds,
                                        thinking: entry.thinking,
                                        numTurns: lines.filter((l) => l.includes('"type":"USER_INPUT"')).length,
                                    };
                                }
                            } catch {
                                // Skip partially written lines
                            }
                        }
                    }
                } catch {
                    // Ignore concurrent file read glitches
                }
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`Timed out after ${(timeoutMs / 1000).toFixed(0)}s waiting for Antigravity desktop response.`);
    }

    /**
     * Get the current line count of transcript.jsonl
     */
    public getTranscriptLineCount(conversationId: string): number {
        const transcriptPath = path.join(
            this.getBrainDir(),
            conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl'
        );

        if (!fs.existsSync(transcriptPath)) return 0;
        try {
            const raw = fs.readFileSync(transcriptPath, 'utf8');
            return raw.trim().split('\n').filter(Boolean).length;
        } catch {
            return 0;
        }
    }

    /**
     * High-level execution method that creates or continues a session and returns an AntigravityResult
     */
    public async executeTurn(options: {
        prompt: string;
        activeConversationId?: string;
        title?: string;
        userTag?: string;
        timeoutMs?: number;
    }): Promise<AntigravityResult> {
        const { prompt, activeConversationId, title, userTag, timeoutMs = 180000 } = options;
        let convId = activeConversationId;
        let initialLines = 0;

        if (convId) {
            initialLines = this.getTranscriptLineCount(convId);
            await this.sendMessage(convId, prompt);
        } else {
            const safeTitle = title || `[Discord] ${prompt.slice(0, 50).replace(/[\r\n]/g, ' ')}`;
            convId = await this.startConversation(safeTitle, prompt);
            initialLines = 0;
        }

        const completion = await this.waitForCompletion(convId, initialLines, timeoutMs);
        const { hasQuestions, questions } = this.extractQuestions(completion.response);

        return {
            success: true,
            conversationId: convId,
            response: completion.response,
            durationSeconds: completion.durationSeconds,
            numTurns: completion.numTurns,
            telemetry: {
                model: `Antigravity 2.0 Desktop App (${convId.slice(0, 8)}...)`,
                turns: completion.numTurns,
            },
            hasQuestions,
            questions,
        };
    }

    /**
     * Extract questions for staff from the text response
     */
    public extractQuestions(text: string): { hasQuestions: boolean; questions?: string[] } {
        const questionSectionRegex = /(?:###?\s*(?:❓|⚠️)?\s*Questions?(?:\s+for\s+Staff)?|Questions?:)([\s\S]*?)(?:###|\n\n---\n\n|$)/i;
        const match = text.match(questionSectionRegex);

        if (match && match[1]) {
            const lines = match[1]
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => /^(?:[-*•]|\d+\.)\s+/.test(l));

            if (lines.length > 0) {
                return { hasQuestions: true, questions: lines };
            }
        }

        const directQuestions = text
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.endsWith('?') && (l.startsWith('1.') || l.startsWith('2.') || l.startsWith('-')));

        if (directQuestions.length > 0) {
            return { hasQuestions: true, questions: directQuestions };
        }

        return { hasQuestions: false };
    }
}

export const antigravityAgentApi = new AntigravityAgentApiService();
