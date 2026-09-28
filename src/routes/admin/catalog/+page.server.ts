import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loadCatalog, seedCatalog, updateProduct, createPrintPackage, duplicateProduct } from '$server/catalog';
import { db, schema } from '$server/db';
import { dollarsToCents } from '$shared/money';

export const load: PageServerLoad = () => ({ catalog: loadCatalog(null, true), costs: Object.fromEntries(db.select({ id: schema.products.id, cost: schema.products.costCents }).from(schema.products).all().map((p) => [p.id, p.cost])) });

export const actions: Actions = {
  save: async (e) => {
    const f = await e.request.formData();
    const id = Number(f.get('id'));
    try {
      updateProduct(id, {
        name: String(f.get('name') ?? '').trim() || undefined, description: String(f.get('description') ?? '') || null,
        priceCents: dollarsToCents(String(f.get('price') ?? '0')), costCents: String(f.get('cost') ?? '').trim() ? dollarsToCents(String(f.get('cost'))) : null,
        active: f.get('active') === 'on', allowMultiPose: f.get('multi') === 'on', sortOrder: Number(f.get('sortOrder')) || 0
      });
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'bad input' }); }
    return { ok: 'Saved' };
  },
  create: async (e) => {
    const f = await e.request.formData();
    try {
      const contents = loadCatalog(null, true).printSizes.map((s) => ({ size: s.code, count: Number(f.get(`qty_${s.code}`)) || 0 }));
      createPrintPackage({ name: String(f.get('name') ?? ''), description: String(f.get('description') ?? ''), priceCents: dollarsToCents(String(f.get('price') ?? '0')), contents });
      return { ok: 'New print offering created.' };
    } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Check your print contents.' }); }
  },
  duplicate: async (e) => { const f = await e.request.formData(); try { duplicateProduct(Number(f.get('id'))); return { ok: 'Copied as an inactive offering. Edit it and activate when ready.' }; } catch (err) { return fail(400, { error: err instanceof Error ? err.message : 'Could not duplicate.' }); } },
  reseed: async () => { seedCatalog(); return { ok: 'Missing starter offerings added. Your existing offerings were left unchanged.' }; }
};
