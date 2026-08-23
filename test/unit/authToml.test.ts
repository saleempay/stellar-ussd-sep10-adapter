import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/errors.js';
import { buildWebAuthConfig, fetchWebAuthConfig } from '../../src/auth/toml.js';

const SIGNING_KEY = 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR';
const HOME_DOMAIN = 'testanchor.stellar.org';

const goodToml = () => ({
  WEB_AUTH_ENDPOINT: 'https://testanchor.stellar.org/auth',
  SIGNING_KEY,
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
});

describe('buildWebAuthConfig', () => {
  it('extracts the SEP-10 coordinates from a well-formed toml', () => {
    const config = buildWebAuthConfig(goodToml(), HOME_DOMAIN);
    expect(config).toEqual({
      homeDomain: HOME_DOMAIN,
      webAuthEndpoint: 'https://testanchor.stellar.org/auth',
      signingKey: SIGNING_KEY,
      webAuthDomain: 'testanchor.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('derives webAuthDomain from the endpoint host, keeping any port', () => {
    const config = buildWebAuthConfig(
      { ...goodToml(), WEB_AUTH_ENDPOINT: 'https://auth.example.com:8443/sep10/auth' },
      'example.com',
    );
    expect(config.webAuthDomain).toBe('auth.example.com:8443');
  });

  it('omits networkPassphrase when the toml does not declare one', () => {
    const toml = goodToml() as Record<string, unknown>;
    delete toml.NETWORK_PASSPHRASE;
    const config = buildWebAuthConfig(toml, HOME_DOMAIN);
    expect('networkPassphrase' in config).toBe(false);
  });

  it('refuses a home domain that carries a protocol', () => {
    expect(() => buildWebAuthConfig(goodToml(), 'https://testanchor.stellar.org')).toThrow(
      ConfigError,
    );
  });

  it('refuses a toml with no WEB_AUTH_ENDPOINT', () => {
    const toml = goodToml() as Record<string, unknown>;
    delete toml.WEB_AUTH_ENDPOINT;
    expect(() => buildWebAuthConfig(toml, HOME_DOMAIN)).toThrow(/no WEB_AUTH_ENDPOINT/);
  });

  it('refuses a WEB_AUTH_ENDPOINT that is not a URL', () => {
    expect(() =>
      buildWebAuthConfig({ ...goodToml(), WEB_AUTH_ENDPOINT: 'not a url' }, HOME_DOMAIN),
    ).toThrow(/not a valid URL/);
  });

  it('refuses a plain-http WEB_AUTH_ENDPOINT: the auth path is HTTPS only', () => {
    expect(() =>
      buildWebAuthConfig(
        { ...goodToml(), WEB_AUTH_ENDPOINT: 'http://testanchor.stellar.org/auth' },
        HOME_DOMAIN,
      ),
    ).toThrow(/must be https/);
  });

  it('refuses a missing or malformed SIGNING_KEY', () => {
    const missing = goodToml() as Record<string, unknown>;
    delete missing.SIGNING_KEY;
    expect(() => buildWebAuthConfig(missing, HOME_DOMAIN)).toThrow(/SIGNING_KEY/);
    expect(() =>
      buildWebAuthConfig({ ...goodToml(), SIGNING_KEY: 'SANOTAPUBLICKEY' }, HOME_DOMAIN),
    ).toThrow(/SIGNING_KEY/);
  });
});

describe('fetchWebAuthConfig', () => {
  it('resolves the toml through the injected resolver and validates it', async () => {
    const seen: string[] = [];
    const config = await fetchWebAuthConfig(HOME_DOMAIN, {
      resolveToml: async (domain) => {
        seen.push(domain);
        return goodToml();
      },
    });
    expect(seen).toEqual([HOME_DOMAIN]);
    expect(config.signingKey).toBe(SIGNING_KEY);
  });

  it('propagates validation refusals from the fetched toml', async () => {
    await expect(
      fetchWebAuthConfig(HOME_DOMAIN, {
        resolveToml: async () => ({ WEB_AUTH_ENDPOINT: 'http://insecure.example/auth', SIGNING_KEY }),
      }),
    ).rejects.toThrow(/must be https/);
  });
});
