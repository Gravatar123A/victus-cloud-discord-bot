import { randomUUID } from 'crypto';
import os from 'os';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import type { AntigravityResult } from './antigravityPipeline.js';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface BridgeTaskRequest {
    taskId: string;
    prompt: string;
    activeConversationId?: string;
    title?: string;
    userTag?: string;
    timeoutMs?: number;
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

export class AntigravityBridgeService {
    private channel: RealtimeChannel | null = null;
    private lastWorkstationHeartbeat = 0;
    private workstationName = '';
    private pendingTasks = new Map<string, {
        resolve: (result: AntigravityResult) => void;
        reject: (err: any) => void;
        timer: NodeJS.Timeout;
    }>();

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
     * Start listening for workstation presence and task responses on the bot side
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

        ch.on('broadcast', { event: 'task_response' }, ({ payload }: { payload: BridgeTaskResponse }) => {
            if (payload && payload.taskId) {
                const pending = this.pendingTasks.get(payload.taskId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pendingTasks.delete(payload.taskId);
                    pending.resolve(payload.result);
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
        // Considered online if heartbeat received within last 30 seconds
        return Date.now() - this.lastWorkstationHeartbeat < 30000;
    }

    /**
     * Actively probe the workstation to check if it is online (with quick ping/pong fallback)
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
    public async dispatchTask(request: Omit<BridgeTaskRequest, 'taskId'>): Promise<AntigravityResult> {
        await this.initBotListener();

        if (!this.isWorkstationOnline()) {
            throw new Error('Workstation Antigravity bridge is offline');
        }

        const taskId = randomUUID();
        const timeoutMs = request.timeoutMs || 240000;

        return new Promise<AntigravityResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingTasks.delete(taskId);
                reject(new Error(`Workstation Antigravity bridge timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            this.pendingTasks.set(taskId, { resolve, reject, timer });

            const payload: BridgeTaskRequest = {
                taskId,
                ...request,
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
     * Start running as the workstation daemon (on the user's PC)
     */
    public async runAsWorkstationDaemon(
        handler: (req: BridgeTaskRequest) => Promise<AntigravityResult>
    ): Promise<void> {
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
            logger.info(`[AntigravityBridge] Received task from Discord: "${payload.prompt.slice(0, 50)}..."`);

            try {
                const result = await handler(payload);
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
