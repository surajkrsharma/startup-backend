import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app';
import { getSpec } from '../src/docs/swagger.routes';

describe('public API surface', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createApp();
  });

  const assertEnvelope = (body: any, expectedStatus: boolean) => {
    expect(body).toBeTypeOf('object');
    expect(Object.keys(body)).toEqual(['status', 'message', 'result']);
    expect(body.status).toBe(expectedStatus);
    expect(body.message).toBeTypeOf('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.result).toBeTypeOf('object');
    expect(body.result).not.toBeNull();
    expect(Array.isArray(body.result)).toBe(false);
  };

  it('GET /api/v1/health returns the uptime envelope', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    assertEnvelope(res.body, true);
    expect(res.body.result.status).toBe('UP');
    expect(res.body.result.version).toBeTruthy();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/v1/health/db reports a database status without throwing', async () => {
    const res = await request(app).get('/api/v1/health/db');

    expect([200, 503]).toContain(res.status);
    assertEnvelope(res.body, true);
    expect(typeof res.body.result.database).toBe('string');
  });

  it('GET /api/v1/health/redis reports a redis status without throwing', async () => {
    const res = await request(app).get('/api/v1/health/redis');

    expect(res.status).toBe(200);
    assertEnvelope(res.body, true);
    expect(typeof res.body.result.redis).toBe('string');
  });

  it('GET /api/v1/version returns API metadata', async () => {
    const res = await request(app).get('/api/v1/version');

    expect(res.status).toBe(200);
    assertEnvelope(res.body, true);
    expect(res.body.result.apiVersion).toBeTruthy();
    expect(res.body.result.prefix).toBe('/api/v1');
  });

  it('GET /api/v1/docs.json serves a valid OpenAPI document', async () => {
    const res = await request(app).get('/api/v1/docs.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBeTruthy();
    expect(res.body.info?.title).toContain('API');
    expect(res.body.components?.schemas?.SuccessResponse).toBeDefined();
    expect(res.body.components?.schemas?.ErrorResponse).toBeDefined();
  });

  it('unknown routes return the 404 envelope with an error code', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    assertEnvelope(res.body, false);
    expect(res.body.message).toContain('NOT_FOUND');
    expect(res.body.result).toEqual({});
  });

  it('echoes the incoming X-Request-Id header', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'trace-me-123');

    expect(res.headers['x-request-id']).toBe('trace-me-123');
  });

  it('sends security headers via helmet', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('leads the OpenAPI spec with the register and login flow, in call order', async () => {
    const spec = getSpec(app) as any;
    const paths = Object.keys(spec.paths ?? {});

    expect(paths.slice(0, 6)).toEqual([
      '/auth/register/sendOtp',
      '/auth/register/verifyOtp',
      '/auth/register',
      '/auth/sendOtp',
      '/auth/login/verifyOtp',
      '/auth/login',
    ]);
  });

  it('puts the Auth tag first so the flow heads the Swagger page', () => {
    const spec = getSpec(app) as any;

    expect(spec.tags?.[0]?.name).toBe('Auth');
  });

  it('serves docs.json with a usable base URL, prefix included', async () => {
    const res = await request(app)
      .get('/api/v1/docs.json')
      .set('Host', 'projectname-api.onrender.com')
      .set('X-Forwarded-Proto', 'https');

    const url: string = res.body.servers?.[0]?.url ?? '';
    expect(res.status).toBe(200);
    expect(url).toMatch(/^https?:\/\//);
    expect(url.endsWith('/api/v1')).toBe(true);
  });

  it('takes the base URL from PUBLIC_API_URL, appending the prefix itself', async () => {
    const configured = process.env.PUBLIC_API_URL?.trim();
    if (!configured) return;

    const res = await request(app).get('/api/v1/docs.json').set('Host', 'localhost:5000');

    const url: string = res.body.servers?.[0]?.url ?? '';
    const expected = configured.replace(/\/+$/, '');

    expect(url).toMatch(/^https?:\/\//);
    expect(url).toBe(expected.endsWith('/api/v1') ? expected : `${expected}/api/v1`);
  });

  it('never advertises an empty base URL, which would drop the prefix', async () => {
    const res = await request(app).get('/api/v1/docs.json');

    const url: string = res.body.servers?.[0]?.url ?? '';
    expect(url.length).toBeGreaterThan(0);
  });
});
