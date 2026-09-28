import { json, type RequestHandler } from '@sveltejs/kit';
import { exiftool } from 'exiftool-vendored';
import { sqlite } from '$server/db';

let exifVersion: string | null = null;
export const GET: RequestHandler = async () => {
  try {
    sqlite.prepare('select 1').get();
    if (!exifVersion) exifVersion = await exiftool.version();
    return json({ ok: true, exiftool: exifVersion });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
};
