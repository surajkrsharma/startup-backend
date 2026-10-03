declare module 'geoip-lite' {
  export interface GeoIpLookup {
    range: [number, number];
    country: string;
    region: string;
    city: string;
    ll: [number, number];
    timezone: string;
  }

  export function lookup(ip: string): GeoIpLookup | null;
  export function lookup(ip: string, kind: string): GeoIpLookup | null;
  export function start(): Promise<void>;
}
