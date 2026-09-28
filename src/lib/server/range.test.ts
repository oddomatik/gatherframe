import { describe, expect, it } from 'vitest';
import { parseByteRange } from './range';

describe('download byte ranges', () => {
  it('returns the last bytes for suffix requests and clips oversized ranges', () => {
    expect(parseByteRange('bytes=-500', 1200)).toEqual({ status: 206, start: 700, end: 1199, length: 500, contentRange: 'bytes 700-1199/1200' });
    expect(parseByteRange('bytes=100-', 1200)).toMatchObject({ status: 206, start: 100, end: 1199, length: 1100 });
    expect(parseByteRange('bytes=100-9999999999999999999999', 1200)).toMatchObject({ status: 206, start: 100, end: 1199 });
    expect(parseByteRange('bytes=-9999999999999999999999', 1200)).toMatchObject({ status: 206, start: 0, end: 1199 });
  });
  it('rejects unsatisfiable or invalid single ranges with the current complete length', () => {
    for (const header of ['bytes=1200-', 'bytes=10-9', 'bytes=-0', 'bytes=-', 'bytes=abc-def', 'bytes=9999999999999999999999-']) {
      expect(parseByteRange(header, 1200), header).toMatchObject({ status: 416, length: 0, contentRange: 'bytes */1200' });
    }
    expect(parseByteRange('bytes=0-', 0)).toMatchObject({ status: 416, contentRange: 'bytes */0' });
  });
  it('ignores unknown units and multipart requests rather than pretending to honor only part', () => {
    for (const header of [null, 'items=0-5', 'bytes=0-5,20-25']) expect(parseByteRange(header, 1200)).toMatchObject({ status: 200, length: 1200 });
  });
});
