import { describe, expect, it } from 'vitest';
import { isPublicAddress, SafeFetchError, safeFetchJson, type SafeResolver } from './safeFetch.js';

const OPTIONS = { maxBytes: 1024, timeoutMs: 2000 };

const resolverFor = (...addresses: string[]): SafeResolver & { calls: number } => {
  const resolver = ((_hostname, callback) => {
    resolver.calls++;
    callback(null, addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));
  }) as SafeResolver & { calls: number };
  resolver.calls = 0;
  return resolver;
};

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ])('allows public %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '10.0.0.1', '127.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2002:a00:1::1', '64:ff9b::a00:1',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a00:1', 'fe80::1%eth0', 'not-an-ip',
  ])('refuses %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('safeFetchJson', () => {
  it('refuses non-https URLs, IP literals, and credentials before any lookup', async () => {
    const resolver = resolverFor('8.8.8.8');
    for (const url of ['http://client.example.com/meta', 'https://127.0.0.1/meta', 'https://[::1]/meta', 'https://user:pw@client.example.com/meta', 'https://localhost/meta']) {
      await expect(safeFetchJson(url, { ...OPTIONS, resolver })).rejects.toBeInstanceOf(SafeFetchError);
    }
    expect(resolver.calls).toBe(0);
  });

  it('refuses a host that resolves to a private address, in the connect lookup itself', async () => {
    const resolver = resolverFor('10.0.0.5');
    await expect(safeFetchJson('https://client.example.com/meta', { ...OPTIONS, resolver })).rejects.toThrow(/non-public address/);
    // One resolution, done by the socket: nothing resolves again between check and connect.
    expect(resolver.calls).toBe(1);
  });

  it('refuses when any resolved address is private, including IPv4-mapped IPv6 and CGNAT', async () => {
    for (const addresses of [['8.8.8.8', '192.168.0.10'], ['::ffff:10.0.0.1'], ['100.64.1.1'], ['2606:4700::1', 'fd00::1']]) {
      await expect(safeFetchJson('https://client.example.com/meta', { ...OPTIONS, resolver: resolverFor(...addresses) })).rejects.toThrow(/non-public address/);
    }
  });

  it('refuses DNS rebinding: an answer that turns private at connect time is what gets checked', async () => {
    let answers = 0;
    const rebinding: SafeResolver = (_hostname, callback) => {
      answers++;
      // A separate pre-check would have seen the public answer; the socket gets the private one.
      callback(null, [{ address: answers === 1 ? '10.0.0.1' : '8.8.8.8', family: 4 }]);
    };
    await expect(safeFetchJson('https://client.example.com/meta', { ...OPTIONS, resolver: rebinding })).rejects.toThrow(/non-public address/);
    expect(answers).toBe(1);
  });
});
