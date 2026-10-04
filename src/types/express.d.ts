import type { Role } from '../constants/roles';

declare global {
  namespace Express {
    interface Request {
      id: string;

      auth?: {
        userId: string;
        role: Role | string;
        vendorId: string;
        email: string;
        sessionKey: string;
        deviceId: string;
        permissions?: string[];
      };

      deviceId?: string;

      sessionKey?: string;

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
