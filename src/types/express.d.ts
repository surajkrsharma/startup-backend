import type { Role } from '../constants/roles';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id assigned by requestId middleware. */
      id: string;
      /** Populated by the authenticate middleware when a valid token is present. */
      auth?: {
        userId: string;
        role: Role | string;
        vendorId: string;
        email: string;
        sessionKey: string;
        deviceId: string;
        permissions?: string[];
      };
      /** Client-generated fingerprint from `x-device-id`. */
      deviceId?: string;
      /** Analytics session key resolved by the tracking middleware. */
      sessionKey?: string;
      /** Device/geo/user-agent capture produced by the tracking middleware. */
      device?: {
        platform: string;
        os: string;
        osVersion: string;
        browser: string;
        browserVersion: string;
        model: string;
        manufacturer: string;
        isBot: boolean;
        userAgent: string;
      };
      geo?: {
        country: string;
        state: string;
        city: string;
        latitude: number;
        longitude: number;
        timezone: string;
      };
      utm?: Record<string, string>;
      ip?: string;
      validatedHeaders?: Record<string, unknown>;
    }
  }
}

export {};
