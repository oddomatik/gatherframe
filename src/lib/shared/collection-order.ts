const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
type NamedCollection = { name: string; id?: number; key?: string; isIntake?: number };

/** Presentation only: keep intake first, then natural names with stable identity ties. */
export function compareCollectionNames(a: NamedCollection, b: NamedCollection): number {
  return Number(!!b.isIntake) - Number(!!a.isIntake)
    || names.compare(a.name.trim().normalize('NFC'), b.name.trim().normalize('NFC'))
    || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
    || (a.key ?? '').localeCompare(b.key ?? '');
}
