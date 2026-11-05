import winston from 'winston';
import colors from 'colors';

// Enable safe colors
colors.enable();

const customLevels = {
  levels: { error: 0, warn: 1, info: 2, debug: 3 },
  colors: { error: 'red', warn: 'yellow', info: 'green', debug: 'cyan' }
};

winston.addColors(customLevels.colors);

// Console output formatter
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module }) => {
    const moduleTag = module ? `[${module}]` : '[SYSTEM]';

    const ts = String(timestamp);
    const msg = String(message);

    if (module === 'SCRAPER') {
      return `${colors.gray(ts)} ${colors.magenta.bold(moduleTag)} ${level}: ${colors.cyan(msg)}`;
    }

    return `${colors.gray(ts)} ${colors.blue.bold(moduleTag)} ${level}: ${msg}`;
  })
);

// Filter format for console to implement the Scraper Mute Feature
const ignoreEmptyConsoleFormat = winston.format((info) => {
  const isMuteScraper = process.env.HIDE_SCRAPER === 'true';
  if (info.module === 'SCRAPER' && isMuteScraper) {
    return false; // Suppress from console
  }
  return info;
});

// File partition filters
const scraperFileFilter = winston.format((info) => {
  return info.module === 'SCRAPER' ? info : false;
});

const backendFileFilter = winston.format((info) => {
  return info.module !== 'SCRAPER' ? info : false;
});

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

export const logger = winston.createLogger({
  levels: customLevels.levels,
  transports: [
    // 1. Console logging with mute capabilities
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'debug',
      format: winston.format.combine(
        ignoreEmptyConsoleFormat(),
        winston.format.colorize({ all: true }),
        consoleFormat
      )
    }),
    // 2. Dedicated Scraper Logs File
    new winston.transports.File({
      filename: 'logs/scraper.log',
      level: 'debug',
      format: winston.format.combine(
        scraperFileFilter(),
        fileFormat
      )
    }),
    // 3. Dedicated Backend Gateway Logs File
    new winston.transports.File({
      filename: 'logs/backend.log',
      level: 'debug',
      format: winston.format.combine(
        backendFileFilter(),
        fileFormat
      )
    })
  ]
});
