import { describe, expect, it } from 'vitest';

import { ConfigError, TESTNET_DEFAULTS, loadConfig } from '../../src/index.js';

const VALID = {
  SPONSOR_PUBLIC_KEY: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  ASSET_CODE: 'SRT',
  ASSET_ISSUER: 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B',
};

describe('loadConfig', () => {
  it('applies testnet defaults for unset network values', () => {
    const config = loadConfig({ ...VALID });
    expect(config.horizonUrl).toBe(TESTNET_DEFAULTS.horizonUrl);
    expect(config.networkPassphrase).toBe(TESTNET_DEFAULTS.networkPassphrase);
    expect(config.friendbotUrl).toBe(TESTNET_DEFAULTS.friendbotUrl);
    expect(config.sponsorPublicKey).toBe(VALID.SPONSOR_PUBLIC_KEY);
    expect(config.asset).toEqual({ code: 'SRT', issuer: VALID.ASSET_ISSUER });
  });

  it('honours explicit overrides', () => {
    const config = loadConfig({
      ...VALID,
      HORIZON_URL: 'https://horizon.example',
      NETWORK_PASSPHRASE: 'Example Net',
      FRIENDBOT_URL: 'https://fb.example',
    });
    expect(config.horizonUrl).toBe('https://horizon.example');
    expect(config.networkPassphrase).toBe('Example Net');
    expect(config.friendbotUrl).toBe('https://fb.example');
  });

  it.each([
    ['SPONSOR_PUBLIC_KEY missing', { ...VALID, SPONSOR_PUBLIC_KEY: undefined }],
    ['SPONSOR_PUBLIC_KEY malformed', { ...VALID, SPONSOR_PUBLIC_KEY: 'SB...definitely-not-public' }],
    ['ASSET_CODE missing', { ...VALID, ASSET_CODE: '' }],
    ['ASSET_CODE too long', { ...VALID, ASSET_CODE: 'THIRTEENCHARS' }],
    ['ASSET_ISSUER missing', { ...VALID, ASSET_ISSUER: undefined }],
    ['ASSET_ISSUER malformed', { ...VALID, ASSET_ISSUER: 'not-a-key' }],
  ])('rejects %s', (_label, env) => {
    expect(() => loadConfig(env as Record<string, string | undefined>)).toThrow(ConfigError);
  });

  it('never accepts a secret key where a public key belongs', () => {
    expect(() =>
      loadConfig({ ...VALID, SPONSOR_PUBLIC_KEY: 'SA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' }),
    ).toThrow(ConfigError);
  });
});
