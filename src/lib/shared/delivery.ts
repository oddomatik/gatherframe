import { z } from 'zod';

/** IDs are project-scoped and never derived from editable labels. Legacy IDs stay valid. */
export const versionKeySchema = z.string().regex(/^(print|social|raw|v_[a-z0-9]{16})$/);
export const recipeSchema = z.object({
  schema: z.literal(1).default(1),
  width: z.number().int().min(320).max(8192).default(2560),
  height: z.number().int().min(320).max(8192).default(2560),
  quality: z.number().int().min(50).max(95).default(85),
  sharpening: z.enum(['none', 'screen']).default('none'),
  metadata: z.enum(['none', 'copyright']).default('none')
}).strict();
export type DeliveryRecipe = z.infer<typeof recipeSchema>;
export const DEFAULT_DELIVERY_RECIPE: DeliveryRecipe = recipeSchema.parse({});
export const LEGACY_VERSIONS = [
  { key: 'print', label: 'Full resolution' },
  { key: 'social', label: 'Web size' },
  { key: 'raw', label: 'Camera RAW' }
] as const;
export const versionInputSchema = z.object({
  key: versionKeySchema.optional(), label: z.string().trim().min(1).max(60),
  mode: z.enum(['uploaded', 'automatic']),
  sourceRole: versionKeySchema.nullable().default(null),
  recipe: recipeSchema.nullable().default(null),
  filenameMode: z.enum(['private', 'original']).default('private'),
  access: z.enum(['free', 'disabled', 'paid']).default('disabled'),
  folder: z.string().trim().max(80).regex(/^[^\\/\x00-\x1f]*$/).default('')
}).strict();
export type VersionInput = z.infer<typeof versionInputSchema>;
