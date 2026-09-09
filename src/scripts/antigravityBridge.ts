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
    logger.info(`📂 Brain directory: ${antigravityAgentApi.getBrainDir()}`);
    logger.info('🔌 Connecting to Supabase Realtime channel "antigravity_bridge"...');

    await antigravityBridge.runAsWorkstationDaemon(async (req) => {
        console.log('\n------------------------------------------------------');
        logger.info(`📩 [TASK RECEIVED] Operator: @${req.userTag || 'staff'}`);
        logger.info(`📝 Prompt: "${req.prompt.slice(0, 100).replace(/[\r\n]/g, ' ')}..."`);
        if (req.activeConversationId) {
            logger.info(`🔄 Continuing existing conversation: ${req.activeConversationId}`);
        } else {
            logger.info('🆕 Spawning brand new conversation session in Antigravity...');
        }

        const startTime = Date.now();
        const result = await antigravityAgentApi.executeTurn({
            prompt: req.prompt,
            activeConversationId: req.activeConversationId,
            title: req.title || `[Discord /staffai] @${req.userTag}`,
            userTag: req.userTag,
            timeoutMs: req.timeoutMs || 240000,
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
