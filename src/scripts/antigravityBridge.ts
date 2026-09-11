import fs from 'fs';
import path from 'path';
import { antigravityBridge } from '../services/antigravityBridge.js';
import { antigravityAgentApi } from '../services/antigravityAgentApi.js';
import { logger } from '../utils/logger.js';

async function main() {
    console.log('\n======================================================');
    console.log('🤖 ANTIGRAVITY WORKSTATION BRIDGE // DAEMON');
    console.log('======================================================');
    console.log('Connecting your local Antigravity runtime to your Discord bot...\n');

    const agentApiExe = antigravityAgentApi.getExecutablePath();
    if (!agentApiExe) {
        logger.error('❌ agentapi binary was not found in ~/.gemini/antigravity/bin/agentapi.bat');
        logger.error('Please ensure Google Antigravity is installed on this PC.');
        process.exit(1);
    }

    logger.info(`✅ Found Antigravity runtime at: ${agentApiExe}`);
    const { address, csrfToken, projectId } = await antigravityAgentApi.getVerifiedLanguageServerEnv();
    if (address) {
        logger.info(`🌐 Antigravity Language Server detected at: ${address} (CSRF: ${csrfToken ? 'verified' : 'none'}, Project: ${projectId || 'default'})`);
    } else {
        logger.warn('⚠️ Language Server address not detected. Make sure Antigravity desktop app is open.');
    }
    logger.info(`📂 Brain directory: ${antigravityAgentApi.getBrainDir()}`);
    logger.info('🔌 Connecting to Supabase Realtime channel "antigravity_bridge"...');

    await antigravityBridge.runAsWorkstationDaemon(async (req, reportProgress) => {
        console.log('\n------------------------------------------------------');
        logger.info(`📩 [TASK RECEIVED] Operator: @${req.userTag || 'staff'}`);
        logger.info(`📝 Prompt: "${req.prompt.slice(0, 100).replace(/[\r\n]/g, ' ')}..."`);

        let effectivePrompt = req.prompt;

        // Process and materialize attachments locally on Windows
        if (req.attachments && req.attachments.length > 0) {
            const localAttachmentsDir = path.resolve(process.cwd(), '.antigravity_discord', 'attachments');
            if (!fs.existsSync(localAttachmentsDir)) {
                fs.mkdirSync(localAttachmentsDir, { recursive: true });
            }

            for (const att of req.attachments) {
                const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const destPath = path.join(localAttachmentsDir, safeName);

                try {
                    if (att.textContent) {
                        fs.writeFileSync(destPath, att.textContent, 'utf8');
                        logger.info(`💾 [Bridge] Saved attachment "${att.name}" locally from payload at: ${destPath}`);
                    } else if (att.url) {
                        const dlRes = await fetch(att.url);
                        if (dlRes.ok) {
                            const buffer = Buffer.from(await dlRes.arrayBuffer());
                            fs.writeFileSync(destPath, buffer);
                            logger.info(`📥 [Bridge] Downloaded attachment "${att.name}" from Discord CDN at: ${destPath}`);
                        }
                    }

                    // Rewrite any remote Linux container paths (/home/container/...) in prompt to the Windows destPath
                    const normalizedDest = destPath.replace(/\\/g, '/');
                    effectivePrompt = effectivePrompt.replace(
                        new RegExp(`(/home/container/)?[^"\\s]*${safeName}`, 'g'),
                        normalizedDest
                    );

                    // If textContent is available, append the content block to effectivePrompt for immediate reading
                    if (att.textContent && att.textContent.length < 100000) {
                        effectivePrompt += `\n\n--- [ATTACHMENT CONTENT: ${att.name}] ---\n${att.textContent}\n--- [END ATTACHMENT: ${att.name}] ---\n`;
                    }
                } catch (saveErr) {
                    logger.warn(`Failed to materialize attachment ${att.name} locally:`, saveErr);
                }
            }
        }

        if (req.activeConversationId) {
            logger.info(`🔄 Continuing existing conversation: ${req.activeConversationId}`);
        } else {
            logger.info('🆕 Spawning brand new conversation session in Antigravity...');
        }

        const startTime = Date.now();
        const result = await antigravityAgentApi.executeTurn({
            prompt: effectivePrompt,
            activeConversationId: req.activeConversationId,
            title: req.title || `[Discord /staffai] @${req.userTag}`,
            userTag: req.userTag,
            timeoutMs: req.timeoutMs || 1800000,
            inactivityTimeoutMs: req.inactivityTimeoutMs || 600000,
            onProgress: async (p) => {
                await reportProgress({
                    elapsedSeconds: p.elapsedSeconds,
                    stepIndex: p.stepIndex,
                    statusMessage: p.statusMessage,
                    lastAction: p.lastAction,
                    lineCount: p.lineCount,
                });
            },
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`✅ [TASK COMPLETE] Session ID: ${result.conversationId} (${elapsed}s)`);
        logger.info(`💬 Response preview: "${result.response.slice(0, 80).replace(/[\r\n]/g, ' ')}..."`);
        if (result.hasQuestions) {
            logger.info(`❓ Questions for staff: ${result.questions?.length || 0}`);
        }
        console.log('------------------------------------------------------\n');

        return result;
    });

    logger.info('🟢 Bridge is LIVE! Tasks from /staffai in Discord will now open right here in your Antigravity desktop app.');
    logger.info('Press Ctrl+C to stop.\n');
}

main().catch((err) => {
    logger.error('Fatal bridge error:', err);
    process.exit(1);
});
