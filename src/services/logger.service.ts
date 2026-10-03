import pino from 'pino';
import { LOGGER } from '../config/logger.config';
import { ENV } from '../config/env.config';

export const logger = pino({
  level: LOGGER.LEVEL,
  name: LOGGER.NAME,
  base: {
    service: LOGGER.NAME,
    env: ENV.NODE_ENV,
  },
  redact: { paths: [...LOGGER.REDACT_PATHS], censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const logInfo = (obj: any, msg?: string) => logger.info(obj ?? {}, msg);
export const logWarn = (obj: any, msg?: string) => logger.warn(obj ?? {}, msg);
export const logError = (obj: any, msg?: string) => logger.error(obj ?? {}, msg);
export const logDebug = (obj: any, msg?: string) => logger.debug(obj ?? {}, msg);
export const logFatal = (obj: any, msg?: string) => logger.fatal(obj ?? {}, msg);

/** Child logger scoped to a module, e.g. `moduleLogger('order')`. */
export const moduleLogger = (module: string) => logger.child({ module });
