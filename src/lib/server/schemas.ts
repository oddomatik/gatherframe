import { z } from 'zod';

export const CartSchema = z.array(z.object({
  key: z.string().min(1).max(40),
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(50),
  sheets: z.array(z.object({
    templateCode: z.string().max(100),
    cells: z.array(z.object({ cellIndex: z.number().int().min(0), photoId: z.number().int().positive().nullable(), sizeChoice: z.string().max(80).nullable().optional(), rotated: z.boolean().optional() })).max(100)
  })).max(50)
})).max(50);
