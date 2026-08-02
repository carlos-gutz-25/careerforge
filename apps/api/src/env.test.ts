import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { envSchema, parseEnv } from './env.ts';

// Fictional bootstrap credentials — tests never touch the real env user.
const VALID = {
  NODE_ENV: 'development',
  API_PORT: '4301',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge',
  AUTH_BOOTSTRAP_EMAIL: 'casey.test@example.com',
  AUTH_BOOTSTRAP_PASSWORD: 'fictional-test-password',
};

describe('parseEnv', () => {
  it('accepts a fully valid environment', () => {
    expect(parseEnv(VALID)).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4301,
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgres://user:pw@localhost:5432/careerforge',
      AUTH_BOOTSTRAP_EMAIL: 'casey.test@example.com',
      AUTH_BOOTSTRAP_PASSWORD: 'fictional-test-password',
      WEB_APP_ORIGIN: 'http://localhost:4300',
      LLM_MODEL: 'claude-sonnet-5',
      API_HOST: '127.0.0.1',
      DEMO_MODE: false,
      TRUST_PROXY: false,
    });
  });

  it('LLM key is optional and empty-string counts as absent; LLM_MODEL defaults (M1-05)', () => {
    expect(parseEnv(VALID).ANTHROPIC_API_KEY).toBeUndefined();
    expect(parseEnv({ ...VALID, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(parseEnv({ ...VALID, ANTHROPIC_API_KEY: 'fictional-key' }).ANTHROPIC_API_KEY).toBe(
      'fictional-key',
    );
    expect(parseEnv({ ...VALID, LLM_MODEL: 'other-model' }).LLM_MODEL).toBe('other-model');
    expect(() => parseEnv({ ...VALID, LLM_MODEL: '' })).toThrowError(/LLM_MODEL/);
  });

  it('applies defaults for optional variables', () => {
    const env = parseEnv({
      DATABASE_URL: VALID.DATABASE_URL,
      AUTH_BOOTSTRAP_EMAIL: VALID.AUTH_BOOTSTRAP_EMAIL,
      AUTH_BOOTSTRAP_PASSWORD: VALID.AUTH_BOOTSTRAP_PASSWORD,
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4301);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.WEB_APP_ORIGIN).toBe('http://localhost:4300');
    expect(env.API_HOST).toBe('127.0.0.1');
    expect(env.WEB_DIST_DIR).toBeUndefined();
  });

  it('API_HOST defaults to loopback, accepts an override, rejects empty (M10-02)', () => {
    expect(parseEnv(VALID).API_HOST).toBe('127.0.0.1');
    expect(parseEnv({ ...VALID, API_HOST: '0.0.0.0' }).API_HOST).toBe('0.0.0.0');
    expect(() => parseEnv({ ...VALID, API_HOST: '' })).toThrowError(/API_HOST/);
  });

  it('WEB_DIST_DIR is optional and empty-string counts as absent (M10-02)', () => {
    expect(parseEnv(VALID).WEB_DIST_DIR).toBeUndefined();
    expect(parseEnv({ ...VALID, WEB_DIST_DIR: '' }).WEB_DIST_DIR).toBeUndefined();
    expect(parseEnv({ ...VALID, WEB_DIST_DIR: '/app/web-dist' }).WEB_DIST_DIR).toBe(
      '/app/web-dist',
    );
  });

  it('DEMO_MODE and TRUST_PROXY default off and are on only for "1" (M10-03)', () => {
    expect(parseEnv(VALID).DEMO_MODE).toBe(false);
    expect(parseEnv(VALID).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...VALID, DEMO_MODE: '', TRUST_PROXY: '0' }).DEMO_MODE).toBe(false);
    expect(parseEnv({ ...VALID, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...VALID, DEMO_MODE: '1' }).DEMO_MODE).toBe(true);
    expect(parseEnv({ ...VALID, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(true);
  });

  it('fail-closed: DEMO_MODE on with an ANTHROPIC_API_KEY present refuses to boot (M10-03)', () => {
    // A demo instance is keyless by decision — a keyed demo must never boot.
    expect(() =>
      parseEnv({ ...VALID, DEMO_MODE: '1', ANTHROPIC_API_KEY: 'fictional-key' }),
    ).toThrowError(/DEMO_MODE/);
    // The key being absent (or empty) with DEMO_MODE on is the valid demo posture.
    expect(parseEnv({ ...VALID, DEMO_MODE: '1' }).DEMO_MODE).toBe(true);
    expect(parseEnv({ ...VALID, DEMO_MODE: '1', ANTHROPIC_API_KEY: '' }).DEMO_MODE).toBe(true);
    // A key with DEMO_MODE off is the normal non-demo posture — allowed.
    expect(parseEnv({ ...VALID, ANTHROPIC_API_KEY: 'fictional-key' }).DEMO_MODE).toBe(false);
  });

  it('fails fast when a required variable is missing, naming it', () => {
    expect(() => parseEnv({ ...VALID, DATABASE_URL: undefined })).toThrowError(/DATABASE_URL/);
  });

  it('rejects a non-numeric port, naming the variable', () => {
    expect(() => parseEnv({ ...VALID, API_PORT: 'not-a-port' })).toThrowError(/API_PORT/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ ...VALID, API_PORT: '70000' })).toThrowError(/API_PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseEnv({ ...VALID, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseEnv({ ...VALID, DATABASE_URL: 'mysql://localhost/nope' })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('fails fast when the bootstrap credentials are missing, naming them', () => {
    expect(() => parseEnv({ ...VALID, AUTH_BOOTSTRAP_EMAIL: undefined })).toThrowError(
      /AUTH_BOOTSTRAP_EMAIL/,
    );
    expect(() => parseEnv({ ...VALID, AUTH_BOOTSTRAP_PASSWORD: undefined })).toThrowError(
      /AUTH_BOOTSTRAP_PASSWORD/,
    );
  });

  it('rejects a malformed bootstrap email', () => {
    expect(() => parseEnv({ ...VALID, AUTH_BOOTSTRAP_EMAIL: 'not-an-email' })).toThrowError(
      /AUTH_BOOTSTRAP_EMAIL/,
    );
  });

  it('rejects a bootstrap password shorter than 12 characters', () => {
    expect(() => parseEnv({ ...VALID, AUTH_BOOTSTRAP_PASSWORD: 'short' })).toThrowError(
      /AUTH_BOOTSTRAP_PASSWORD/,
    );
  });

  it('rejects a WEB_APP_ORIGIN that is not a URL', () => {
    expect(() => parseEnv({ ...VALID, WEB_APP_ORIGIN: 'not a url' })).toThrowError(
      /WEB_APP_ORIGIN/,
    );
  });

  it('ignores unrelated variables present in process.env', () => {
    expect(() => parseEnv({ ...VALID, PATH: '/usr/bin', SHELL: '/bin/zsh' })).not.toThrow();
  });
});

describe('.env.example contract', () => {
  it('documents every variable the schema validates', () => {
    const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const documented = new Set(
      example
        .split('\n')
        .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
        .filter((name) => name !== undefined),
    );
    for (const key of Object.keys(envSchema.shape)) {
      expect(documented, `${key} is missing from .env.example`).toContain(key);
    }
  });
});
