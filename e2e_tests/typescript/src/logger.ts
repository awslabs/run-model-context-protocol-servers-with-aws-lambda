import winston from "winston";

// Configure the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} - ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} - ${level.toUpperCase()}: ${message}`;
        })
      ),
    }),
  ],
});

export default logger;
