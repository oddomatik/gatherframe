import { asc, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from './db';
import type { Catalog, Product, SheetTemplate } from '$shared/catalog';
import { SEED_PRINT_SIZES, SEED_PRODUCTS, SEED_SHEETS } from './catalog.seed';
import { getSettings } from './settings';
import { randomId } from './ids';

export function defaultCatalogId(): number | null {
  return db.select({ id: schema.catalogs.id }).from(schema.catalogs).orderBy(sql`${schema.catalogs.isDefault} desc`, asc(schema.catalogs.id)).get()?.id ?? null;
}

/** Full catalog for one catalog id (default when null), in the shared shape the builder consumes. */
export function loadCatalog(catalogId: number | null | undefined, includeInactive = false): Catalog {
  const cid = catalogId ?? defaultCatalogId();
  const currency = (cid ? db.select({ c: schema.catalogs.currency }).from(schema.catalogs).where(eq(schema.catalogs.id, cid)).get()?.c : null) ?? getSettings().currency;
  const printSizes = db.select().from(schema.printSizes).all().map((s) => ({ code: s.code, label: s.label, widthIn: s.widthIn, heightIn: s.heightIn }));
  const sheets: Record<string, SheetTemplate> = {};
  const tplRows = db.select().from(schema.sheetTemplates).all();
  const cellRows = db.select().from(schema.sheetTemplateCells).orderBy(asc(schema.sheetTemplateCells.cellIndex)).all();
  for (const t of tplRows) {
    sheets[t.code] = {
      code: t.code, label: t.label, paperWidthIn: t.paperWidthIn, paperHeightIn: t.paperHeightIn,
      cells: cellRows.filter((c) => c.sheetTemplateId === t.id).map((c) => ({
        cellIndex: c.cellIndex, printSizeCode: c.printSizeCode, label: c.label, xIn: c.xIn, yIn: c.yIn, wIn: c.wIn, hIn: c.hIn,
        rotation: (c.rotation === 90 ? 90 : 0), cellGroup: c.cellGroup, sizeOptions: c.sizeOptions ?? null
      }))
    };
  }
  const products: Product[] = [];
  if (cid) {
    const prodRows = db.select().from(schema.products).where(eq(schema.products.catalogId, cid)).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)).all();
    const psRows = db.select({ productId: schema.productSheets.productId, code: schema.sheetTemplates.code, label: schema.productSheets.label, sortOrder: schema.productSheets.sortOrder })
      .from(schema.productSheets).innerJoin(schema.sheetTemplates, eq(schema.sheetTemplates.id, schema.productSheets.sheetTemplateId)).orderBy(asc(schema.productSheets.sortOrder)).all();
    for (const p of prodRows) {
      if (!includeInactive && !p.active) continue;
      products.push({
        id: p.id, code: p.code, kind: p.kind === 'package' ? 'package' : 'single', name: p.name, description: p.description, priceCents: p.priceCents,
        allowMultiPose: !!p.allowMultiPose, active: !!p.active, sortOrder: p.sortOrder,
        sheets: psRows.filter((s) => s.productId === p.id).map((s) => ({ templateCode: s.code, label: s.label }))
      });
    }
  }
  return { currency, printSizes, sheets, products };
}

/** Per-event price overrides and deactivations, applied on top of the catalog. */
export function eventCatalog(eventId: number, catalogId: number | null | undefined): { catalog: Catalog; overrides: Record<number, number> } {
  const base = loadCatalog(catalogId);
  const rows = db.select().from(schema.eventProducts).where(eq(schema.eventProducts.eventId, eventId)).all();
  const overrides: Record<number, number> = {};
  const inactive = new Set<number>();
  for (const r of rows) { if (!r.active) inactive.add(r.productId); if (r.priceCentsOverride != null) overrides[r.productId] = r.priceCentsOverride; }
  return { catalog: { ...base, products: base.products.filter((p) => !inactive.has(p.id)).map((p) => ({ ...p, name: p.name === 'Wallets (sheet of 4)' ? 'Wallets (set of 4)' : p.name === 'Mini wallets (sheet of 4)' ? 'Mini wallets (set of 4)' : p.name, priceCents: overrides[p.id] ?? p.priceCents })) }, overrides };
}

export function listCatalogs() { return db.select().from(schema.catalogs).orderBy(asc(schema.catalogs.id)).all(); }

/** Load the first-event catalog. Idempotent: updates sizes/sheets/products by code; never deletes. */
export function seedCatalog(): { catalogId: number } {
  return sqlite.transaction(() => {
    let cid = db.select({ id: schema.catalogs.id }).from(schema.catalogs).where(eq(schema.catalogs.isDefault, 1)).get()?.id;
    if (!cid) cid = db.insert(schema.catalogs).values({ name: 'School pictures', isDefault: 1, currency: getSettings().currency }).returning().get().id;
    for (const s of SEED_PRINT_SIZES)
      db.insert(schema.printSizes).values({ code: s.code, label: s.label, widthIn: s.widthIn, heightIn: s.heightIn })
        .onConflictDoUpdate({ target: schema.printSizes.code, set: { label: s.label, widthIn: s.widthIn, heightIn: s.heightIn } }).run();
    for (const sh of SEED_SHEETS) {
      if (db.select({ id: schema.sheetTemplates.id }).from(schema.sheetTemplates).where(eq(schema.sheetTemplates.code, sh.code)).get()) continue;
      const t = db.insert(schema.sheetTemplates).values({ code: sh.code, label: sh.label, paperWidthIn: sh.paperWidthIn, paperHeightIn: sh.paperHeightIn })
        .onConflictDoUpdate({ target: schema.sheetTemplates.code, set: { label: sh.label, paperWidthIn: sh.paperWidthIn, paperHeightIn: sh.paperHeightIn } }).returning().get();
      db.delete(schema.sheetTemplateCells).where(eq(schema.sheetTemplateCells.sheetTemplateId, t.id)).run();
      for (const c of sh.cells)
        db.insert(schema.sheetTemplateCells).values({ sheetTemplateId: t.id, cellIndex: c.cellIndex, printSizeCode: c.printSizeCode, label: c.label, xIn: c.xIn, yIn: c.yIn, wIn: c.wIn, hIn: c.hIn, rotation: c.rotation, cellGroup: c.cellGroup ?? null, sizeOptions: c.sizeOptions ?? null }).run();
    }
    SEED_PRODUCTS.forEach((p, i) => {
      const existing = db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.code, p.code)).get();
      if (existing) return; // Re-running setup adds missing offerings; never resets customized products.
      const row = db.insert(schema.products).values({ catalogId: cid!, kind: p.kind, code: p.code, name: p.name, description: p.description, priceCents: p.priceCents, costCents: p.costCents, allowMultiPose: p.allowMultiPose ? 1 : 0, active: 1, sortOrder: i }).returning().get();
      db.delete(schema.productSheets).where(eq(schema.productSheets.productId, row.id)).run();
      p.sheets.forEach((code, j) => {
        const t = db.select({ id: schema.sheetTemplates.id }).from(schema.sheetTemplates).where(eq(schema.sheetTemplates.code, code)).get();
        if (t) db.insert(schema.productSheets).values({ productId: row.id, sheetTemplateId: t.id, sortOrder: j }).run();
      });
    });
    return { catalogId: cid! };
  })();
}

export function ensureCatalog(): void { if (!defaultCatalogId()) seedCatalog(); }

export function updateProduct(id: number, patch: { name?: string; description?: string | null; priceCents?: number; costCents?: number | null; active?: boolean; allowMultiPose?: boolean; sortOrder?: number }): void {
  for (const amount of [patch.priceCents, patch.costCents]) if (amount != null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error('Prices and costs must be zero or more.');
  const set: Partial<typeof schema.products.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.priceCents !== undefined) set.priceCents = patch.priceCents;
  if (patch.costCents !== undefined) set.costCents = patch.costCents;
  if (patch.active !== undefined) set.active = patch.active ? 1 : 0;
  if (patch.allowMultiPose !== undefined) set.allowMultiPose = patch.allowMultiPose ? 1 : 0;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (Object.keys(set).length) db.update(schema.products).set(set).where(eq(schema.products.id, id)).run();
}

export function setEventProduct(eventId: number, productId: number, patch: { priceCentsOverride?: number | null; active?: boolean }): void {
  if (patch.priceCentsOverride != null && (!Number.isSafeInteger(patch.priceCentsOverride) || patch.priceCentsOverride < 0)) throw new Error('Prices must be zero or more.');
  const existing = db.select().from(schema.eventProducts).where(sql`${schema.eventProducts.eventId} = ${eventId} and ${schema.eventProducts.productId} = ${productId}`).get();
  const values = { priceCentsOverride: patch.priceCentsOverride === undefined ? existing?.priceCentsOverride ?? null : patch.priceCentsOverride, active: patch.active === undefined ? (existing?.active ?? 1) : (patch.active ? 1 : 0) };
  if (existing) db.update(schema.eventProducts).set(values).where(eq(schema.eventProducts.id, existing.id)).run();
  else db.insert(schema.eventProducts).values({ eventId, productId, ...values }).run();
}

/** Author packages from print contents. Internal one-print templates are only a data model,
 * never a requirement to select paper or an instruction to crop/print automatically. */
export function createPrintPackage(input: { name: string; description?: string; priceCents: number; contents: { size: string; count: number }[] }): number {
  return sqlite.transaction(() => {
    if (!input.name.trim()) throw new Error('Give the offering a name.');
    if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0) throw new Error('Price must be zero or more.');
    const contents = input.contents.filter((c) => c.count > 0);
    if (!contents.length || contents.some((c) => !Number.isSafeInteger(c.count) || c.count > 50) || contents.reduce((n, c) => n + c.count, 0) > 100) throw new Error('Choose between 1 and 100 prints, with at most 50 of any size.');
    const sizes = db.select().from(schema.printSizes).all();
    if (contents.some((c) => !sizes.some((s) => s.code === c.size))) throw new Error('Unknown print size.');
    const code = `custom_${randomId(10)}`;
    const cid = defaultCatalogId(); if (!cid) throw new Error('Create a catalog first.');
    const p = db.insert(schema.products).values({ catalogId: cid, code, name: input.name.trim().slice(0, 120), description: input.description?.trim() || null, priceCents: input.priceCents, active: 1, allowMultiPose: 1, kind: contents.reduce((n, c) => n + c.count, 0) === 1 ? 'single' : 'package', sortOrder: 100 }).returning().get();
    let index = 0;
    for (const c of contents) {
      const size = sizes.find((s) => s.code === c.size)!;
      for (let n = 0; n < c.count; n++) {
        const template = db.insert(schema.sheetTemplates).values({ code: `${code}_${index}`, label: size.label, paperWidthIn: size.widthIn, paperHeightIn: size.heightIn }).returning().get();
        db.insert(schema.sheetTemplateCells).values({ sheetTemplateId: template.id, cellIndex: 0, printSizeCode: size.code, label: size.label, xIn: 0, yIn: 0, wIn: size.widthIn, hIn: size.heightIn, rotation: 0 }).run();
        db.insert(schema.productSheets).values({ productId: p.id, sheetTemplateId: template.id, sortOrder: index++ }).run();
      }
    }
    return p.id;
  })();
}
export function duplicateProduct(id: number): number {
  return sqlite.transaction(() => {
    const product = db.select().from(schema.products).where(eq(schema.products.id, id)).get();
    if (!product) throw new Error('Offering not found.');
    const { id: _id, ...values } = product;
    const copy = db.insert(schema.products).values({ ...values, code: `custom_${randomId(10)}`, name: `${product.name} (copy)`, active: 0 }).returning().get();
    for (const sh of db.select().from(schema.productSheets).where(eq(schema.productSheets.productId, id)).all()) db.insert(schema.productSheets).values({ productId: copy.id, sheetTemplateId: sh.sheetTemplateId, sortOrder: sh.sortOrder, label: sh.label }).run();
    return copy.id;
  })();
}
