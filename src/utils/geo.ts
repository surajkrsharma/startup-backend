import geoip from 'geoip-lite';
import { DEFAULT_COUNTRY_CODE } from '../constants/countries';
import { APP } from '../config/app.config';

export interface GeoInfo {
  country: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

const EMPTY_GEO: GeoInfo = {
  country: '',
  state: '',
  city: '',
  latitude: 0,
  longitude: 0,
  timezone: APP.DEFAULT_TIMEZONE,
};

export const resolveIp = (req: any): string => {
  const forwarded = req.headers?.['x-forwarded-for'];
  const candidate = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split?.(',')?.[0]?.trim() ||
      req.headers?.['x-real-ip'] ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';
  return String(candidate || '').replace('::ffff:', '');
};

export const lookupGeo = (ip: string): GeoInfo => {
  if (!ip || ip === 'unknown') return { ...EMPTY_GEO };

  try {
    const result = geoip.lookup(ip);
    if (!result) return { ...EMPTY_GEO, country: DEFAULT_COUNTRY_CODE };

    return {
      country: result.country || '',
      state: result.region || '',
      city: result.city || '',
      latitude: Number(result.ll?.[0] ?? 0),
      longitude: Number(result.ll?.[1] ?? 0),
      timezone: result.timezone || APP.DEFAULT_TIMEZONE,
    };
  } catch {
    return { ...EMPTY_GEO };
  }
};

export const parseUtm = (query: any): Record<string, string> => ({
  utmSource: String(query?.utmSource ?? query?.utm_source ?? ''),
  utmMedium: String(query?.utmMedium ?? query?.utm_medium ?? ''),
  utmCampaign: String(query?.utmCampaign ?? query?.utm_campaign ?? ''),
  utmTerm: String(query?.utmTerm ?? query?.utm_term ?? ''),
  utmContent: String(query?.utmContent ?? query?.utm_content ?? ''),
});
