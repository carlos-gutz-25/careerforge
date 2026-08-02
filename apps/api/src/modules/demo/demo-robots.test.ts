// robots.txt + noindex header (M10-04, D5): a public demo instance must never
// be indexed. DB-free (buildApp is lazy; nothing here queries). The conditional
// registration is asserted in BOTH modes so a real instance is proven
// byte-for-byte unchanged. Every credential is fictional (ADR-0007).
import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.ts';
import { parseEnv } from '../../env.ts';
import { DEMO_ROBOTS_TXT } from './demo.hooks.ts';

const BASE_ENV = {
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge_test',
  AUTH_BOOTSTRAP_EMAIL: 'casey.test@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-test-password',
};
const demoEnv = () => parseEnv({ ...BASE_ENV, NODE_ENV: 'test', DEMO_MODE: '1' });
const realEnv = () => parseEnv({ ...BASE_ENV, NODE_ENV: 'test' });

describe('demo robots.txt + noindex header (M10-04, D5)', () => {
  it('serves a public robots.txt disallowing all crawlers in demo mode', async () => {
    const app = await buildApp(demoEnv());
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe(DEMO_ROBOTS_TXT);
    expect(res.body).toContain('Disallow: /');
    await app.close();
  });

  it('stamps X-Robots-Tag: noindex, nofollow on EVERY response in demo mode', async () => {
    const app = await buildApp(demoEnv());
    // /health stands in for "every response" - the onSend hook is global.
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-robots-tag']).toBe('noindex, nofollow');
    // The robots.txt response carries the header too.
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.headers['x-robots-tag']).toBe('noindex, nofollow');
    await app.close();
  });

  it('on a real instance robots.txt is 404 and no X-Robots-Tag is sent', async () => {
    const app = await buildApp(realEnv());
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(404);
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.headers['x-robots-tag']).toBeUndefined();
    await app.close();
  });
});
