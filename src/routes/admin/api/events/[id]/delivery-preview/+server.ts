import { error, type RequestHandler } from '@sveltejs/kit';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { assertPhotoProject, currentFile } from '$server/delivery';
import { renderDeliveryJpeg } from '$server/delivery-render';
import { withImageBudget } from '$server/image-budget';
import { materializeObject, assertScratchSpace } from '$server/blob-store';
import { storage } from '$server/storage';
import { randomId } from '$server/ids';
import { rateLimit } from '$server/ratelimit';
import { recipeSchema, versionKeySchema } from '$shared/delivery';

const bodySchema = z.object({ photoId: z.number().int().positive(), sourceRole: versionKeySchema, recipe: recipeSchema }).strict();
export const POST: RequestHandler = async e => {
  if (!e.locals.admin) throw error(401, 'Please sign in');
  if (!rateLimit(`delivery-preview:${e.locals.admin.id}`, 8, 60_000).ok) throw error(429, 'Please wait a moment before making another preview.');
  const body = bodySchema.safeParse(await e.request.json().catch(() => null));
  if (!body.success) throw error(400, 'Check the preview settings.');
  try { assertPhotoProject(Number(e.params.id), body.data.photoId); } catch { throw error(404, 'Photo not found'); }
  const source = currentFile(body.data.photoId, body.data.sourceRole);
  if (!source || source.origin !== 'uploaded' || !source.available) throw error(400, 'Upload this photo’s selected source first.');
  return withImageBudget(async () => {
    await assertScratchSpace(128 * 1024 * 1024);
    const input = await materializeObject(source.storagePath), temp = storage.abs(storage.tmp(`delivery-preview-${randomId(20)}.jpg`));
    try {
      const result = await renderDeliveryJpeg(input.path, body.data.recipe, temp);
      const file = await fs.readFile(temp);
      if (currentFile(body.data.photoId, body.data.sourceRole)?.sha256 !== source.sha256) throw error(409, 'The source changed. Preview it again.');
      return new Response(new Uint8Array(file), { headers: { 'content-type':'image/jpeg', 'cache-control':'private, no-store', 'x-image-width':String(result.width), 'x-image-height':String(result.height) } });
    } catch (err) { if (err && typeof err === 'object' && 'status' in err) throw err; throw error(400, 'Could not preview this source. Use a conventional SDR JPEG and check free storage.'); }
    finally { await fs.rm(temp, { force:true }); await input.release(); }
  });
};
