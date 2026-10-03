import { UAParser } from 'ua-parser-js';
import { HEADER } from '../config/app.config';
import { PLATFORM, Platform } from '../constants/roles';
import { nanoid } from 'nanoid';

export interface ParsedDevice {
  platform: Platform | 'OTHER';
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  model: string;
  manufacturer: string;
  isBot: boolean;
  userAgent: string;
  deviceType: string;
}

const BOT_REGEX =
  /bot|crawl|spider|slurp|curl|wget|python|java|okhttp|axios|node-fetch|postman|insomnia|headless|lighthouse|pingdom|monitoring|preview|facebookexternalhit|whatsapp|telegrambot|slackbot/i;

/** Parses the User-Agent into a normalised device fingerprint. */
export const parseUserAgent = (userAgent: string): ParsedDevice => {
  const ua = userAgent || '';
  const parser = new UAParser(ua);
  const result = parser.getResult();

  const osName = result.os?.name ?? '';
  const osVersion = result.os?.version ?? '';
  const browserName = result.browser?.name ?? '';
  const browserVersion = result.browser?.version ?? '';

  let platform: Platform | 'OTHER' = PLATFORM.OTHER;
  const deviceType = (result.device?.type ?? '').toString().toLowerCase();

  if (/android/i.test(osName)) platform = PLATFORM.ANDROID;
  else if (/ios|iphone|ipad|ipod/i.test(osName)) platform = PLATFORM.IOS;
  else if (ua.length === 0 || /webar|ember|chrome|firefox|safari|edge|opera/i.test(browserName)) {
    platform = PLATFORM.WEB;
  }

  const isBot =
    BOT_REGEX.test(ua) ||
    (result.device?.type === undefined &&
      browserName === '' &&
      osName === '' &&
      ua.length > 0 &&
      deviceType === '');

  return {
    platform,
    os: osName,
    osVersion,
    browser: browserName,
    browserVersion,
    model: result.device?.model ?? '',
    manufacturer: result.device?.vendor ?? '',
    isBot,
    userAgent: ua,
    deviceType,
  };
};

/** Client-generated fingerprint id; falls back to a UA/IP-derived hash. */
export const resolveDeviceId = (req: any): string => {
  const header = req.headers?.[HEADER.DEVICE_ID];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim().slice(0, 64);

  const ip = (req.ip || '').replace('::ffff:', '');
  const ua = req.headers?.['user-agent'] || '';
  const seed = `${ip}|${ua}|${HEADER.PLATFORM}|${req.headers?.[HEADER.PLATFORM] || ''}`;
  return `srv_${hashToId(seed)}`;
};

const hashToId = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + nanoid(6);
};

/** Client-supplied platform header wins over UA sniffing (native apps know better). */
export const resolvePlatform = (req: any, parsed: ParsedDevice): Platform | 'OTHER' => {
  const header = req.headers?.[HEADER.PLATFORM];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && String(fromHeader).toUpperCase() in PLATFORM) {
    return String(fromHeader).toUpperCase() as Platform;
  }
  return parsed.platform;
};
