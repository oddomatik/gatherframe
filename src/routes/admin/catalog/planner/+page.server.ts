import type { PageServerLoad } from './$types';
import { loadCatalog } from '$server/catalog';

export const load: PageServerLoad = ({ url }) => ({
  catalog: loadCatalog(null, true),
  initialProduct: url.searchParams.get('product'),
  initialTemplate: url.searchParams.get('template')
});
