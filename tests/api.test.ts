import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app';

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
});
