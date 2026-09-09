import { randomUUID } from 'crypto';
import os from 'os';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
export class AntigravityBridgeService {
    channel = null;
    lastWorkstationHeartbeat = 0;
    workstationName = '';
    pendingTasks = new Map();
    isSubscribed = false;
    /**
     * Get or initialize the shared Realtime channel
     */
    getChannel() {
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
    async initBotListener() {
        if (this.isSubscribed)
            return;
        const ch = this.getChannel();
        ch.on('broadcast', { event: 'heartbeat' }, ({ payload }) => {
            if (payload && payload.timestamp) {
                this.lastWorkstationHeartbeat = payload.timestamp;
                this.workstationName = payload.workstation || 'Windows Workstation';
            }
        });
        ch.on('broadcast', { event: 'task_response' }, ({ payload }) => {
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
    isWorkstationOnline() {
        // Considered online if heartbeat received within last 30 seconds
        return Date.now() - this.lastWorkstationHeartbeat < 30000;
    }
    /**
     * Get workstation status info
     */
    getWorkstationInfo() {
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
    async dispatchTask(request) {
        await this.initBotListener();
        if (!this.isWorkstationOnline()) {
            throw new Error('Workstation Antigravity bridge is offline');
        }
        const taskId = randomUUID();
        const timeoutMs = request.timeoutMs || 240000;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingTasks.delete(taskId);
                reject(new Error(`Workstation Antigravity bridge timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);
            this.pendingTasks.set(taskId, { resolve, reject, timer });
            const payload = {
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
    async runAsWorkstationDaemon(handler) {
        const ch = this.getChannel();
        ch.on('broadcast', { event: 'task_request' }, async ({ payload }) => {
            if (!payload || !payload.taskId)
                return;
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
            }
            catch (err) {
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
    sendHeartbeat() {
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
        }).catch(() => { });
    }
}
export const antigravityBridge = new AntigravityBridgeService();
