import dns from 'dns';
import https from 'https';
import net from 'net';

// Fetches small JSON documents from URLs that outside parties control (OAuth Client ID
// Metadata Documents) without letting them reach internal addresses (SSRF).
//
// The address check runs inside the socket's own DNS lookup (the `lookup` option of
// https.request), so the addresses that were validated are exactly the ones the socket
// connects to: a second resolution that could return a different, private address
// (DNS rebinding) never happens. TLS still verifies the certificate against the URL's
// hostname, because the request is made by hostname, not by IP.
//
// Only reviewed callers should use this module.

export class SafeFetchError extends Error {}

export type SafeResolver = (hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

const systemResolver: SafeResolver = (hostname, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, callback);
};

// Non-public IPv4 ranges (RFC 6890 special-purpose registry and friends).
const IPV4_DENY: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
// IPv6 must be global unicast (2000::/3) and outside these special blocks.
const IPV6_DENY: [string, number][] = [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
];

const ipv4Deny = new net.BlockList();
for (const [address, prefix] of IPV4_DENY) {
  ipv4Deny.addSubnet(address, prefix, 'ipv4');
}
const ipv6Deny = new net.BlockList();
for (const [address, prefix] of IPV6_DENY) {
  ipv6Deny.addSubnet(address, prefix, 'ipv6');
}
const ipv6GlobalUnicast = new net.BlockList();
ipv6GlobalUnicast.addSubnet('2000::', 3, 'ipv6');

const MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

// True only for publicly routable unicast addresses. IPv4-mapped IPv6 in dotted form
// is judged as the IPv4 address it carries; any other mapped or zoned form is refused.
export const isPublicAddress = (raw: string): boolean => {
  const address = raw.trim().toLowerCase();
  if (address.includes('%')) {
    return false;
  }
  const mapped = MAPPED_DOTTED.exec(address);
  if (mapped) {
    return isPublicAddress(mapped[1]);
  }
  const family = net.isIP(address);
  if (family === 4) {
    return !ipv4Deny.check(address, 'ipv4');
  }
  if (family === 6) {
    return ipv6GlobalUnicast.check(address, 'ipv6') && !ipv6Deny.check(address, 'ipv6');
  }
  return false;
};

const validatingLookup = (resolver: SafeResolver): net.LookupFunction => (hostname, options, callback) => {
  resolver(hostname, (err, addresses) => {
    if (err) {
      callback(err, '', 4);
      return;
    }
    if (addresses.length === 0 || addresses.some(entry => !isPublicAddress(entry.address))) {
      callback(new SafeFetchError(`Refusing to connect: ${hostname} resolves to a non-public address`), '', 4);
      return;
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (err: null, addresses: dns.LookupAddress[]) => void)(null, addresses);
      return;
    }
    callback(null, addresses[0].address, addresses[0].family);
  });
};

export type SafeFetchOptions = {
  maxBytes: number;
  timeoutMs: number;
  resolver?: SafeResolver;
};

export type SafeFetchResult = {
  body: unknown;
  // Seconds from Cache-Control max-age, when present.
  maxAgeSeconds: number | null;
};

// GET an https URL and parse a JSON body. Refuses: other schemes, IP-literal hosts,
// credentials in the URL, non-public addresses, redirects, non-200, non-JSON, bodies
// over maxBytes, and anything slower than timeoutMs. No proxy, no connection reuse.
export const safeFetchJson = (rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> => new Promise((resolve, reject) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    reject(new SafeFetchError('Invalid URL'));
    return;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || net.isIP(hostname) !== 0 || !hostname.includes('.')) {
    reject(new SafeFetchError('Only https URLs with a DNS hostname are allowed'));
    return;
  }

  let settled = false;
  const fail = (error: Error) => {
    if (!settled) {
      settled = true;
      reject(error instanceof SafeFetchError ? error : new SafeFetchError(error.message));
    }
  };

  const req = https.request(url, {
    method: 'GET',
    agent: false,
    headers: { Accept: 'application/json', 'User-Agent': 'dnd-fam-ftw-oauth' },
    lookup: validatingLookup(options.resolver ?? systemResolver),
    // Whole-request deadline (connect, TLS, headers, and body), not just socket idle time.
    signal: AbortSignal.timeout(options.timeoutMs),
  }, res => {
    if (res.statusCode !== 200) {
      res.resume();
      fail(new SafeFetchError(`Unexpected status ${res.statusCode ?? 'unknown'}`));
      req.destroy();
      return;
    }
    if (!/^application\/([a-z.+-]*\+)?json\b/i.test(res.headers['content-type'] ?? '')) {
      res.resume();
      fail(new SafeFetchError('Response is not JSON'));
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBytes) {
        fail(new SafeFetchError(`Response larger than ${options.maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => {
      if (settled) {
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(res.headers['cache-control'] ?? '');
        settled = true;
        resolve({ body, maxAgeSeconds: maxAge ? Number(maxAge[1]) : null });
      } catch {
        fail(new SafeFetchError('Response is not valid JSON'));
      }
    });
    res.on('error', fail);
  });
  req.on('error', error => fail(error.name === 'AbortError' || error.name === 'TimeoutError' ? new SafeFetchError(`Timed out after ${options.timeoutMs} ms`) : error));
  req.end();
});
