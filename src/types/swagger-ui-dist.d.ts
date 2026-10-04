declare module 'swagger-ui-dist' {
  /** Directory holding the shipped swagger-ui assets. */
  export function getAbsoluteFSPath(): string;

  export function absolutePath(): string;

  export const SwaggerUIBundle: unknown;
  export const SwaggerUIStandalonePreset: unknown;
}
