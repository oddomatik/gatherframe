import {promises as fs} from 'node:fs';
import {storage as paths} from '$server/storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { setStorageMode, storageStatus, testStorageConnection } from '$server/blob-store';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.admin) throw redirect(303, '/admin/login');
  const status = await storageStatus();
  let backup:{completedAt:string;objects:number;stale:boolean}|null=null;
  try {const receipt=JSON.parse(await fs.readFile(paths.abs('backups/offserver-status.json'),'utf8'));const time=Date.parse(receipt.completedAt);if(receipt.archiveRestoreVerified===true&&receipt.allFileHashes===true&&Number.isFinite(time)&&Number.isSafeInteger(receipt.objects))backup={completedAt:receipt.completedAt,objects:receipt.objects,stale:Date.now()-time>36*3600000};}catch{/* Not yet reported by the independent backup controller. */}
  // Explicitly whitelist browser-visible information. Credentials belong only on the server.
  return { backup, storage: {
    mode: status.mode, configured: status.configured, endpoint: status.endpoint,
    bucket: status.bucket, prefix: status.prefix,
    counts: { local: status.counts.local, remote: status.counts.remote },
    testedAt: status.testedAt
  } };
};

export const actions: Actions = {
  test: async ({ locals }) => {
    if (!locals.admin) return fail(401, { error: 'Please sign in first.' });
    const status = await storageStatus();
    if (!status.configured) return fail(400, { error: 'Add the B2 connection settings on the server first, then restart the app.' });
    try {
      await testStorageConnection();
      return { ok: 'B2 connection checked: the test file was uploaded, read back, verified, and removed. You can now choose a B2 storage option.' };
    } catch {
      // SDK errors can contain signed requests or credential details. Never send them to the browser.
      return fail(400, { error: 'The B2 connection test did not complete. Check the endpoint, bucket, and application-key permissions on the server, then try again. Your storage choice has not changed.' });
    }
  },
  save: async ({ locals, request }) => {
    if (!locals.admin) return fail(401, { error: 'Please sign in first.' });
    const mode = (await request.formData()).get('mode');
    if (mode !== 'local' && mode !== 'b2' && mode !== 'mirror') return fail(400, { error: 'Choose one of the storage options below.' });
    const status = await storageStatus();
    if (mode !== 'local' && (!status.configured || !status.testedAt)) {
      return fail(400, { error: 'Complete a successful B2 connection test before choosing B2 for new files.' });
    }
    try {
      await setStorageMode(mode);
      return { ok: 'Storage choice saved for new files. Existing photos have not been moved or deleted.' };
    } catch {
      return fail(400, { error: 'The storage choice could not be saved. Check the connection and try again. Existing photos have not been moved or deleted.' });
    }
  }
};
