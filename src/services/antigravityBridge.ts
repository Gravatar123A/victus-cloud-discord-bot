import { randomUUID } from 'crypto';
import os from 'os';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import type { AntigravityResult } from './antigravityPipeline.js';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface BridgeTaskAttachment {
    name: string;
    url: string;
    contentType?: string;
    textContent?: string;
}

export interface BridgeTaskRequest {
    taskId: string;
    prompt: string;
    rawPrompt?: string;
    activeConversationId?: string;
    title?: string;
    userTag?: string;
    userId?: string;
    channelId?: string;
    threadId?: string;
    timeoutMs?: number;
    inactivityTimeoutMs?: number;
    attachments?: BridgeTaskAttachment[];
    dispatchedAt?: number;
}

export interface BridgeTaskProgress {
    taskId: string;
    elapsedSeconds: number;
    stepIndex?: number;
    statusMessage?: string;
    lastAction?: string;
    lineCount?: number;
}

export interface BridgeTaskResponse {
    taskId: string;
    result: AntigravityResult;
}

export interface WorkstationPresence {
    workstation: string;
    user: string;
    timestamp: number;
}

export type LateCompletionHandler = (info: {
    taskId: string;
    result: AntigravityResult;
    channelId?: string;
    threadId?: string;
    userTag?: string;
    rawPrompt?: string;
}) => Promise<void>;

export class AntigravityBridgeService {
    private channel: RealtimeChannel | null = null;
    private lastWorkstationHeartbeat = 0;
    private workstationName = '';
    private pendingTasks = new Map<string, {
        resolve: (result: AntigravityResult) => void;
        reject: (err: any) => void;
        timer: NodeJS.Timeout;
        inactivityTimeoutMs: number;
        onProgress?: (progress: BridgeTaskProgress) => void | Promise<void>;
    }>();

    private dispatchedTaskMetadata = new Map<string, {
        channelId?: string;
        threadId?: string;
        userTag?: string;
        rawPrompt?: string;
        dispatchedAt: number;
    }>();

    private lateCompletionHandler: LateCompletionHandler | null = null;
    private isSubscribed = false;

    /**
     * Get or initialize the shared Realtime channel
     */
    private getChannel(): RealtimeChannel {
        if (!this.channel) {
            this.channel = supabase.client.channel('antigravity_bridge', {
                config: {
                    broadcast: { self: true },
                },
            });
        }
        return this.channel;
    }

    /**
     * Register a callback to post results in Discord when a task completes after the initial timeout
     */
    public setLateCompletionHandler(handler: LateCompletionHandler): void {
        this.lateCompletionHandler = handler;
    }

    /**
     * Start listening for workstation presence, progress, and task responses on the bot side
     */
    public async initBotListener(): Promise<void> {
        if (this.isSubscribed) return;

        const ch = this.getChannel();

        ch.on('broadcast', { event: 'heartbeat' }, ({ payload }: { payload: WorkstationPresence }) => {
            if (payload && payload.timestamp) {
                this.lastWorkstationHeartbeat = payload.timestamp;
                this.workstationName = payload.workstation || 'Windows Workstation';
            }
        });

        ch.on('broadcast', { event: 'pong' }, ({ payload }: { payload: WorkstationPresence }) => {
            if (payload && payload.timestamp) {
                this.lastWorkstationHeartbeat = payload.timestamp;
                this.workstationName = payload.workstation || 'Windows Workstation';
            }
        });

        ch.on('broadcast', { event: 'task_progress' }, async ({ payload }: { payload: BridgeTaskProgress }) => {
            if (payload && payload.taskId) {
                const pending = this.pendingTasks.get(payload.taskId);
                if (pending) {
                    // Reset watchdog timer on every progress heartbeat so active tasks never fail prematurely
                    clearTimeout(pending.timer);
                    pending.timer = setTimeout(() => {
                        this.pendingTasks.delete(payload.taskId);
                        pending.reject(
                            new Error(`Workstation Antigravity bridge timed out after ${pending.inactivityTimeoutMs / 1000}s of inactivity.`)
                        );
                    }, pending.inactivityTimeoutMs);

                    if (pending.onProgress) {
                        try {
                            await pending.onProgress(payload);
                        } catch {}
                    }
                }
            }
        });

        ch.on('broadcast', { event: 'task_response' }, async ({ payload }: { payload: BridgeTaskResponse }) => {
            if (payload && payload.taskId) {
                const pending = this.pendingTasks.get(payload.taskId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pendingTasks.delete(payload.taskId);
                    pending.resolve(payload.result);
                } else {
                    // Task finished after the initial promise expired: deliver directly to Discord!
                    const meta = this.dispatchedTaskMetadata.get(payload.taskId);
                    if (meta && (meta.channelId || meta.threadId)) {
                        logger.info(`[AntigravityBridge] Delivering late completion for task ${payload.taskId} to Discord...`);
                        if (this.lateCompletionHandler) {
                            try {
                                await this.lateCompletionHandler({
                                    taskId: payload.taskId,
                                    result: payload.result,
                                    channelId: meta.channelId,
                                    threadId: meta.threadId,
                                    userTag: meta.userTag,
                                    rawPrompt: meta.rawPrompt,
                                });
                            } catch (lateErr) {
                                logger.error(`[AntigravityBridge] Failed to deliver late completion for task ${payload.taskId}:`, lateErr);
                            }
                        }
                    }
                }
            }
        });

        ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                this.isSubscribed = true;
                logger.info('[AntigravityBridge] Bot subscribed to Supabase Realtime bridge channel');
            }
        });
    }

    /**
     * Check if a workstation bridge is actively connected and sending heartbeats
     */
    public isWorkstationOnline(): boolean {
        return Date.now() - this.lastWorkstationHeartbeat < 30000;
    }

    /**
     * Actively probe the workstation to check if it is online
     */
    public async checkWorkstationOnline(): Promise<boolean> {
        await this.initBotListener();
        if (this.isWorkstationOnline()) return true;

        try {
            const ch = this.getChannel();
            await ch.send({
                type: 'broadcast',
                event: 'ping',
                payload: { timestamp: Date.now() },
            });

            const start = Date.now();
            while (Date.now() - start < 2000) {
                if (this.isWorkstationOnline()) return true;
                await new Promise((resolve) => setTimeout(resolve, 150));
            }
        } catch {}

        return this.isWorkstationOnline();
    }

    /**
     * Get workstation status info
     */
    public getWorkstationInfo(): { online: boolean; name: string; lastSeenAgoSeconds: number } {
        const diffSeconds = Math.round((Date.now() - this.lastWorkstationHeartbeat) / 1000);
        return {
            online: this.isWorkstationOnline(),
            name: this.workstationName || 'Unknown Workstation',
            lastSeenAgoSeconds: this.lastWorkstationHeartbeat ? diffSeconds : -1,
        };
    }

    /**
     * Dispatch a task from the cloud bot to the workstation bridge
     */
    public async dispatchTask(
        request: Omit<BridgeTaskRequest, 'taskId'> & {
            onProgress?: (progress: BridgeTaskProgress) => void | Promise<void>;
        }
    ): Promise<AntigravityResult> {
        await this.initBotListener();

        if (!this.isWorkstationOnline()) {
            throw new Error('Workstation Antigravity bridge is offline');
        }

        const taskId = randomUUID();
        const timeoutMs = request.timeoutMs || 1800000; // 30 minutes overall maximum
        const inactivityTimeoutMs = request.inactivityTimeoutMs || 600000; // 10 minutes inactivity

        // Store metadata for resilient late delivery
        this.dispatchedTaskMetadata.set(taskId, {
            channelId: request.channelId,
            threadId: request.threadId,
            userTag: request.userTag,
            rawPrompt: request.rawPrompt,
            dispatchedAt: Date.now(),
        });

        // Prune old metadata over 2 hours old
        const twoHoursAgo = Date.now() - 7200000;
        for (const [id, meta] of this.dispatchedTaskMetadata.entries()) {
            if (meta.dispatchedAt < twoHoursAgo) {
                this.dispatchedTaskMetadata.delete(id);
            }
        }

        return new Promise<AntigravityResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingTasks.delete(taskId);
                reject(
                    new Error(`Workstation Antigravity bridge timed out after ${inactivityTimeoutMs / 1000}s of inactivity.`)
                );
            }, inactivityTimeoutMs);

            this.pendingTasks.set(taskId, {
                resolve,
                reject,
                timer,
                inactivityTimeoutMs,
                onProgress: request.onProgress,
            });

            const payload: BridgeTaskRequest = {
                taskId,
                dispatchedAt: Date.now(),
                prompt: request.prompt,
                rawPrompt: request.rawPrompt,
                activeConversationId: request.activeConversationId,
                title: request.title,
                userTag: request.userTag,
                userId: request.userId,
                channelId: request.channelId,
                threadId: request.threadId,
                timeoutMs,
                inactivityTimeoutMs,
                attachments: request.attachments,
            };

            const ch = this.getChannel();
            ch.send({
                type: 'broadcast',
                event: 'task_request',
                payload,
            }).catch((err) => {
                clearTimeout(timer);
                this.pendingTasks.delete(taskId);
                reject(err);
            });
        });
    }

    /**
     * Workstation daemon emits progress update back to the cloud bot
     */
    public async reportProgress(progress: BridgeTaskProgress): Promise<void> {
        const ch = this.getChannel();
        await ch.send({
            type: 'broadcast',
            event: 'task_progress',
            payload: progress,
        }).catch((err) => {
            logger.warn('[AntigravityBridge] Failed to broadcast task progress:', err);
        });
    }

    /**
     * Start running as the workstation daemon (on the user's PC)
     */
    public async runAsWorkstationDaemon(
        handler: (
            req: BridgeTaskRequest,
            reportProgress: (p: Omit<BridgeTaskProgress, 'taskId'>) => Promise<void>
        ) => Promise<AntigravityResult>
    ): Promise<void> {
        const daemonStartedAt = Date.now();
        const processedTasks = new Set<string>();

        const ch = this.getChannel();
        ch.on('broadcast', { event: 'ping' }, () => {
            ch.send({
                type: 'broadcast',
                event: 'pong',
                payload: {
                    workstation: os.hostname(),
                    user: os.userInfo().username,
                    timestamp: Date.now(),
                },
            }).catch(() => {});
        });

        ch.on('broadcast', { event: 'task_request' }, async ({ payload }: { payload: BridgeTaskRequest }) => {
            if (!payload || !payload.taskId) return;

            // Deduplicate
            if (processedTasks.has(payload.taskId)) {
                logger.warn(`[AntigravityBridge] Ignoring duplicate task ${payload.taskId}`);
                return;
            }
            processedTasks.add(payload.taskId);

            // Stale/pending task protection:
            // If the task was dispatched before this bridge daemon session started, or is older than 45 seconds,
            // do NOT execute it. Discard cleanly so staff can initiate a fresh task.
            const now = Date.now();
            const isDispatchedBeforeStart = payload.dispatchedAt && payload.dispatchedAt < (daemonStartedAt - 5000);
            const isOld = payload.dispatchedAt && (now - payload.dispatchedAt > 45000);

            if (isDispatchedBeforeStart || isOld) {
                logger.warn(
                    `[AntigravityBridge] ⏭️ Skipping pending/stale task ${payload.taskId} from @${payload.userTag || 'staff'} (dispatched ${payload.dispatchedAt ? Math.round((now - payload.dispatchedAt) / 1000) + 's ago' : 'prior to daemon start'}). Waiting for staff to submit a new task.`
                );
                await ch.send({
                    type: 'broadcast',
                    event: 'task_response',
                    payload: {
                        taskId: payload.taskId,
                        result: {
                            success: false,
                            response: '⚠️ **Task cleared**: This task was pending from a previous session or bridge restart and was safely cleared. Please submit a new `/staffai` task to begin work.',
                            hasQuestions: false,
                            error: 'Task cleared on bridge reconnect',
                        },
                    },
                }).catch(() => {});
                return;
            }

            logger.info(`[AntigravityBridge] Received task from Discord: "${payload.prompt.slice(0, 50)}..."`);

            const progressReporter = async (p: Omit<BridgeTaskProgress, 'taskId'>) => {
                await this.reportProgress({
                    taskId: payload.taskId,
                    ...p,
                });
            };

            try {
                const result = await handler(payload, progressReporter);
                await ch.send({
                    type: 'broadcast',
                    event: 'task_response',
                    payload: {
                        taskId: payload.taskId,
                        result,
                    },
                });
                logger.info(`[AntigravityBridge] Successfully processed and replied for task ${payload.taskId}`);
            } catch (err: any) {
                logger.error(`[AntigravityBridge] Error processing task ${payload.taskId}:`, err);
                await ch.send({
                    type: 'broadcast',
                    event: 'task_response',
                    payload: {
                        taskId: payload.taskId,
                        result: {
                            success: false,
                            response: `Workstation execution error: ${err?.message || 'Unknown error'}`,
                            hasQuestions: false,
                            error: err?.message,
                        },
                    },
                });
            }
        });

        ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                logger.info('🚀 [AntigravityBridge] Workstation Bridge connected to Supabase Realtime!');
                this.lastWorkstationHeartbeat = Date.now();
                this.workstationName = os.hostname();
                this.sendHeartbeat();
            }
        });

        // Send heartbeat every 10 seconds
        setInterval(() => this.sendHeartbeat(), 10000);
    }

    private sendHeartbeat(): void {
        this.lastWorkstationHeartbeat = Date.now();
        this.workstationName = os.hostname();
        const ch = this.getChannel();
        ch.send({
            type: 'broadcast',
            event: 'heartbeat',
            payload: {
                workstation: os.hostname(),
                user: os.userInfo().username,
                timestamp: Date.now(),
            },
        }).catch(() => {});
    }
}

export const antigravityBridge = new AntigravityBridgeService();

