import winston from 'winston';
import { config } from '../config.js';
export function cleanLogText(text) {
    if (!text)
        return '';
    let str = typeof text === 'string' ? text : (text instanceof Error ? (text.stack || text.message) : String(text));
    // Check if the log text contains a Cloudflare or Supabase HTML error page
    if (str.includes('<!DOCTYPE html') || str.includes('<html') || str.includes('cf-error-details') || str.includes('522: Connection timed out')) {
        const rayMatch = str.match(/Cloudflare Ray ID:\s*<strong[^>]*>([a-f0-9]+)<\/strong>/i) || str.match(/Ray ID:\s*([a-f0-9]+)/i);
        const rayId = rayMatch ? ` [Ray ID: ${rayMatch[1]}]` : '';
        return `Cloudflare 522: Connection timed out to Supabase origin${rayId}`;
    }
    if (str.includes('DatabaseTimeout') || str.includes('connection to the database timed out')) {
        return 'Supabase 544: Database connection timed out';
    }
    if (str.includes('504: Gateway Timeout') || str.includes('"message":"Gateway Timeout"')) {
        return 'Supabase 504: Gateway Timeout';
    }
    if (str.includes('FunctionsHttpError') || str.includes('Edge Function returned a non-2xx status code')) {
        const detailMatch = str.match(/status \d+\)?(?::\s*(\{.*\}|[^\n]+))?/i);
        const detail = detailMatch ? ` (${detailMatch[0]})` : '';
        return `Supabase Edge Function error${detail}`;
    }
    return str;
}
const logFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.printf(({ level, message, timestamp, stack }) => {
    const emoji = {
        error: '❌',
        warn: '⚠️',
        info: '📘',
        debug: '🔍',
    }[level] || '📋';
    const content = cleanLogText(stack || message);
    return `${timestamp} ${emoji} [${level.toUpperCase()}]: ${content}`;
}));
export const logger = winston.createLogger({
    level: config.bot.logLevel,
    format: logFormat,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), logFormat),
        }),
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});
// Log uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason);
});
