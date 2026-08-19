import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The live-testnet integration test self-gates on RUN_TESTNET_E2E;
    // nothing here reaches the network unless that flag is set.
    testTimeout: 120_000,
  },
});
