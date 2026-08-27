import { describe, expect, it } from 'vitest';

import { GatewayRequestError } from '../../src/errors.js';
import {
  AfricasTalkingGateway,
  AT_HOP_HEADER,
} from '../../src/ussd/gateway/africasTalking.js';

const gw = new AfricasTalkingGateway();

function body(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('AfricasTalkingGateway.parseStep', () => {
  it('parses the initial dial (empty text) into zero inputs', () => {
    const step = gw.parseStep({
      headers: {},
      body: body({
        sessionId: 'ATUid_1',
        serviceCode: '*384*1234#',
        phoneNumber: '+999700000001',
        networkCode: '99901',
        text: '',
      }),
    });
    expect(step.sessionId).toBe('ATUid_1');
    expect(step.msisdnRaw).toBe('+999700000001');
    expect(step.networkCode).toBe('99901');
    expect(step.serviceCode).toBe('*384*1234#');
    expect(step.inputs).toEqual([]);
    expect(step.rawText).toBe('');
  });

  it('splits the cumulative text field on * into ordered inputs', () => {
    const step = gw.parseStep({
      headers: {},
      body: body({ sessionId: 's', phoneNumber: '+999700000001', text: '1*7391*1' }),
    });
    expect(step.inputs).toEqual(['1', '7391', '1']);
    expect(step.rawText).toBe('1*7391*1');
  });

  it('preserves empty positions from consecutive separators', () => {
    // A user pressing send with no input produces an empty element; the
    // machine treats it as an invalid choice, so the position must survive.
    const step = gw.parseStep({
      headers: {},
      body: body({ sessionId: 's', phoneNumber: '+999700000001', text: '1**2' }),
    });
    expect(step.inputs).toEqual(['1', '', '2']);
  });

  it('decodes url-encoded fields (the + in E.164 arrives as %2B)', () => {
    const step = gw.parseStep({
      headers: {},
      body: 'sessionId=s&phoneNumber=%2B999700000001&text=1',
    });
    expect(step.msisdnRaw).toBe('+999700000001');
  });

  it('treats an absent text field as the initial dial', () => {
    const step = gw.parseStep({
      headers: {},
      body: body({ sessionId: 's', phoneNumber: '+999700000001' }),
    });
    expect(step.inputs).toEqual([]);
  });

  it.each([
    ['missing sessionId', { phoneNumber: '+999700000001', text: '' }],
    ['empty sessionId', { sessionId: '', phoneNumber: '+999700000001', text: '' }],
    ['missing phoneNumber', { sessionId: 's', text: '' }],
    ['empty phoneNumber', { sessionId: 's', phoneNumber: '', text: '' }],
  ])('rejects a callback with %s', (_label, fields) => {
    expect(() => gw.parseStep({ headers: {}, body: body(fields) })).toThrow(
      GatewayRequestError,
    );
  });
});

describe('AfricasTalkingGateway.renderResponse', () => {
  it('renders a continuing screen with the CON prefix and text/plain', () => {
    const res = gw.renderResponse({ kind: 'con', text: 'Enter your PIN' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('CON Enter your PIN');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('renders a final screen with the END prefix', () => {
    const res = gw.renderResponse({ kind: 'end', text: 'Goodbye' });
    expect(res.body).toBe('END Goodbye');
  });

  it('sets the hop metadata header to the state label', () => {
    const res = gw.renderResponse({ kind: 'con', text: 'x', hop: 'pinEnter' });
    expect(res.headers[AT_HOP_HEADER]).toBe('pinEnter');
  });

  it('omits the hop header when no label is given', () => {
    const res = gw.renderResponse({ kind: 'con', text: 'x' });
    expect(res.headers[AT_HOP_HEADER]).toBeUndefined();
  });

  it('enforces the documented hop constraints: no pipe, at most 99 chars', () => {
    const res = gw.renderResponse({
      kind: 'con',
      text: 'x',
      hop: 'a|b'.padEnd(150, 'z'),
    });
    const value = res.headers[AT_HOP_HEADER];
    expect(value).not.toContain('|');
    expect(value.length).toBeLessThanOrEqual(99);
  });
});
