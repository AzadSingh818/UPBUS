"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const colors_1 = __importDefault(require("colors"));
// Enable safe colors
colors_1.default.enable();
const customLevels = {
    levels: { error: 0, warn: 1, info: 2, debug: 3 },
    colors: { error: 'red', warn: 'yellow', info: 'green', debug: 'cyan' }
};
winston_1.default.addColors(customLevels.colors);
// Console output formatter
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, level, message, module }) => {
    const moduleTag = module ? `[${module}]` : '[SYSTEM]';
    const ts = String(timestamp);
    const msg = String(message);
    if (module === 'SCRAPER') {
        return `${colors_1.default.gray(ts)} ${colors_1.default.magenta.bold(moduleTag)} ${level}: ${colors_1.default.cyan(msg)}`;
    }
    return `${colors_1.default.gray(ts)} ${colors_1.default.blue.bold(moduleTag)} ${level}: ${msg}`;
}));
// Filter format for console to implement the Scraper Mute Feature
const ignoreEmptyConsoleFormat = winston_1.default.format((info) => {
    const isMuteScraper = process.env.HIDE_SCRAPER === 'true';
    if (info.module === 'SCRAPER' && isMuteScraper) {
        return false; // Suppress from console
    }
    return info;
});
// File partition filters
const scraperFileFilter = winston_1.default.format((info) => {
    return info.module === 'SCRAPER' ? info : false;
});
const backendFileFilter = winston_1.default.format((info) => {
    return info.module !== 'SCRAPER' ? info : false;
});
const fileFormat = winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json());
exports.logger = winston_1.default.createLogger({
    levels: customLevels.levels,
    transports: [
        // 1. Console logging with mute capabilities
        new winston_1.default.transports.Console({
            level: process.env.LOG_LEVEL || 'debug',
            format: winston_1.default.format.combine(ignoreEmptyConsoleFormat(), winston_1.default.format.colorize({ all: true }), consoleFormat)
        }),
        // 2. Dedicated Scraper Logs File
        new winston_1.default.transports.File({
            filename: 'logs/scraper.log',
            level: 'debug',
            format: winston_1.default.format.combine(scraperFileFilter(), fileFormat)
        }),
        // 3. Dedicated Backend Gateway Logs File
        new winston_1.default.transports.File({
            filename: 'logs/backend.log',
            level: 'debug',
            format: winston_1.default.format.combine(backendFileFilter(), fileFormat)
        })
    ]
});
