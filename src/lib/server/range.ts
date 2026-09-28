export interface ByteRange {
  status: 200 | 206 | 416;
  start: number;
  end: number;
  length: number;
  contentRange?: string;
}

/** RFC 9110 §14.2: one byte range, including suffixes. Unsupported/multipart ranges are ignored.
 * BigInt avoids overflow when a valid client asks for an end/suffix beyond Number.MAX_SAFE_INTEGER.
 */
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid representation size');
  const full: ByteRange = { status: 200, start: 0, end: size - 1, length: size };
  if (!header) return full;
  const value = header.trim();
  if (!/^bytes=/i.test(value) || value.includes(',')) return full;
  const rejected: ByteRange = { status: 416, start: 0, end: -1, length: 0, contentRange: `bytes */${size}` };
  if (value.length > 2000) return rejected;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return rejected;
  const total = BigInt(size);
  let start: bigint, end: bigint;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (!suffix) return rejected;
    start = suffix >= total ? 0n : total - suffix;
    end = total - 1n;
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : total - 1n;
    if (start >= total || end < start) return rejected;
    if (end >= total) end = total - 1n;
  }
  return { status: 206, start: Number(start), end: Number(end), length: Number(end - start + 1n), contentRange: `bytes ${start}-${end}/${size}` };
}
