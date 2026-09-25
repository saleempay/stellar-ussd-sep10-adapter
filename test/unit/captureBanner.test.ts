/**
 * Issue #8: the live gateway capture's startup banner.
 *
 * The callback path is a capability credential. The banner must show it
 * only in masked form, and must not name the stale `/ussd/callback` path
 * the handler never serves.
 */

import { describe, expect, it } from 'vitest';

import { captureBanner, maskCallbackPath } from '../integration/helpers.js';

const PATH = '/3f9c2a7e1b4d8f6a0c5e9b2d7a1f4c8e';

describe('capture banner (issue #8)', () => {
  it('never contains the full callback path or the stale /ussd/callback text', () => {
    const banner = captureBanner(8085, PATH);
    expect(banner).not.toContain(PATH);
    expect(banner).not.toContain(PATH.slice(1));
    expect(banner).not.toContain('/ussd/callback');
  });

  it('names USSD_CALLBACK_PATH and shows only the masked form', () => {
    const banner = captureBanner(8085, PATH);
    expect(banner).toContain('USSD_CALLBACK_PATH');
    expect(banner).toContain('/****4c8e');
    expect(banner).toContain('port 8085');
  });

  it('masks to the last 4 characters behind a fixed mask that hides the length', () => {
    expect(maskCallbackPath(PATH)).toBe('/****4c8e');
    expect(maskCallbackPath(`${PATH}00ff`)).toBe('/****00ff');
    expect(maskCallbackPath('/short')).toBe('/****');
  });
});
