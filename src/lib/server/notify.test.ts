import { describe, expect, it } from 'vitest';
import { isPrivateIp } from './notify';

describe('isPrivateIp', () => {
  it('flags loopback, RFC1918, link-local and CGNAT ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.199', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  });
});
