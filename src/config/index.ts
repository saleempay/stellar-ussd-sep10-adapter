/**
 * Environment-driven configuration.
 *
 * All values default to Stellar **testnet**. Mainnet operation is out of
 * scope for this reference implementation and has not been validated.
 */

import { ConfigError } from '../errors.js';

/** Resolved adapter configuration. */
export interface AdapterConfig {
  /** Horizon base URL. */
  horizonUrl: string;
  /** Network passphrase matching {@link horizonUrl}'s network. */
  networkPassphrase: string;
  /** Friendbot URL used only by testnet setup tooling. */
  friendbotUrl: string;
  /** Public key (G...) of the operator account that sponsors reserves. */
  sponsorPublicKey: string;
  /** Asset the reference flow establishes a trustline to. */
  asset: { code: string; issuer: string };
}

/** Testnet defaults applied when the corresponding variable is unset. */
export const TESTNET_DEFAULTS = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  friendbotUrl: 'https://friendbot.stellar.org',
} as const;

/**
 * Build an {@link AdapterConfig} from an environment map.
 *
 * @param env - Usually `process.env`; injectable for tests.
 * @throws ConfigError when a required value is missing or malformed.
 */
export function loadConfig(env: Record<string, string | undefined>): AdapterConfig {
  const sponsorPublicKey = required(env, 'SPONSOR_PUBLIC_KEY');
  if (!/^G[A-Z2-7]{55}$/.test(sponsorPublicKey)) {
    throw new ConfigError(
      'SPONSOR_PUBLIC_KEY must be a Stellar public key (G..., 56 characters).',
    );
  }
  const assetCode = required(env, 'ASSET_CODE');
  if (!/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
    throw new ConfigError('ASSET_CODE must be 1-12 alphanumeric characters.');
  }
  const assetIssuer = required(env, 'ASSET_ISSUER');
  if (!/^G[A-Z2-7]{55}$/.test(assetIssuer)) {
    throw new ConfigError(
      'ASSET_ISSUER must be a Stellar public key (G..., 56 characters). ' +
        'Read it from the issuing anchor stellar.toml — do not copy it from ' +
        'unverified sources.',
    );
  }
  return {
    horizonUrl: env.HORIZON_URL || TESTNET_DEFAULTS.horizonUrl,
    networkPassphrase: env.NETWORK_PASSPHRASE || TESTNET_DEFAULTS.networkPassphrase,
    friendbotUrl: env.FRIENDBOT_URL || TESTNET_DEFAULTS.friendbotUrl,
    sponsorPublicKey,
    asset: { code: assetCode, issuer: assetIssuer },
  };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}
