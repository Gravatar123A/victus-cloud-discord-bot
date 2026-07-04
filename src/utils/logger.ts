import winston from 'winston';
import { config } from '../config.js';

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
        const emoji = {
            error: '❌',
            warn: '⚠️',
            info: '📘',
            debug: '🔍',
        }[level] || '📋';

        return `${timestamp} ${emoji} [${level.toUpperCase()}]: ${stack || message}`;
    })
);

export const logger = winston.createLogger({
    level: config.bot.logLevel,
    format: logFormat,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            ),
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

process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled Rejection:', reason);
});
