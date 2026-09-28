import type { SheetTemplate } from '$shared/catalog';

/**
 * First-event catalog. Geometry in inches, origin top-left, portrait paper unless noted.
 * Only on-screen diagrams use these numbers today; confirm the 13x19 composite against the
 * Lightroom Picture Package template before the sheet renderer ships.
 */
export const SEED_PRINT_SIZES = [
  { code: 'mini_wallet', label: 'mini wallet 2x3', widthIn: 2, heightIn: 3 },
  { code: 'wallet', label: 'wallet 2.5x3.5', widthIn: 2.5, heightIn: 3.5 },
  { code: '4x6', label: '4x6', widthIn: 4, heightIn: 6 },
  { code: '5x7', label: '5x7', widthIn: 5, heightIn: 7 },
  { code: '8x10', label: '8x10', widthIn: 8, heightIn: 10 },
  { code: '11x14', label: '11x14', widthIn: 11, heightIn: 14 },
  { code: '12x18', label: '12x18', widthIn: 12, heightIn: 18 }
];

const cell = (cellIndex: number, printSizeCode: string, label: string, xIn: number, yIn: number, wIn: number, hIn: number, extra: Partial<SheetTemplate['cells'][number]> = {}) =>
  ({ cellIndex, printSizeCode, label, xIn, yIn, wIn, hIn, rotation: 0 as 0 | 90, cellGroup: null, sizeOptions: null, ...extra });

export const SEED_SHEETS: SheetTemplate[] = [
  { code: '4x6_single', label: '4x6 sheet', paperWidthIn: 4, paperHeightIn: 6, cells: [cell(0, '4x6', '4x6', 0, 0, 4, 6)] },
  { code: '4x6_4up_mini', label: '4x6 sheet, four mini wallets', paperWidthIn: 4, paperHeightIn: 6,
    cells: [cell(0, 'mini_wallet', 'mini wallet', 0, 0, 2, 3, { cellGroup: 'mini wallets' }), cell(1, 'mini_wallet', 'mini wallet', 2, 0, 2, 3, { cellGroup: 'mini wallets' }),
      cell(2, 'mini_wallet', 'mini wallet', 0, 3, 2, 3, { cellGroup: 'mini wallets' }), cell(3, 'mini_wallet', 'mini wallet', 2, 3, 2, 3, { cellGroup: 'mini wallets' })] },
  { code: '5x7_single', label: '5x7 sheet', paperWidthIn: 5, paperHeightIn: 7, cells: [cell(0, '5x7', '5x7', 0, 0, 5, 7)] },
  { code: '5x7_4up_wallet', label: '5x7 sheet, four wallets', paperWidthIn: 5, paperHeightIn: 7,
    cells: [cell(0, 'wallet', 'wallet', 0, 0, 2.5, 3.5, { cellGroup: 'wallets' }), cell(1, 'wallet', 'wallet', 2.5, 0, 2.5, 3.5, { cellGroup: 'wallets' }),
      cell(2, 'wallet', 'wallet', 0, 3.5, 2.5, 3.5, { cellGroup: 'wallets' }), cell(3, 'wallet', 'wallet', 2.5, 3.5, 2.5, 3.5, { cellGroup: 'wallets' })] },
  { code: '8x10_single', label: '8x10 sheet', paperWidthIn: 8, paperHeightIn: 10, cells: [cell(0, '8x10', '8x10', 0, 0, 8, 10)] },
  { code: '8x10_2up_5x7', label: '8x10 sheet (landscape), two 5x7', paperWidthIn: 10, paperHeightIn: 8,
    cells: [cell(0, '5x7', '5x7', 0, 0.5, 5, 7), cell(1, '5x7', '5x7', 5, 0.5, 5, 7)] },
  { code: '8x10_5x7_4wallet', label: '8x10 sheet, one 5x7 + four wallets', paperWidthIn: 8, paperHeightIn: 10,
    cells: [cell(0, '5x7', '5x7', 0, 0, 5, 7),
      cell(1, 'wallet', 'wallet', 5, 0, 2.5, 3.5, { cellGroup: 'wallets' }), cell(2, 'wallet', 'wallet', 5, 3.5, 2.5, 3.5, { cellGroup: 'wallets' }),
      cell(3, 'wallet', 'wallet', 0, 7, 3.5, 2.5, { cellGroup: 'wallets', rotation: 90 }), cell(4, 'wallet', 'wallet', 3.5, 7, 3.5, 2.5, { cellGroup: 'wallets', rotation: 90 })] },
  { code: '13x19_composite', label: '13x19 sheet: 8x10 + two 5x7 + four wallets', paperWidthIn: 13, paperHeightIn: 19,
    cells: [cell(0, '8x10', '8x10', 0, 0, 8, 10), cell(1, '5x7', '5x7', 8, 0, 5, 7), cell(2, '5x7', '5x7', 8, 7, 5, 7),
      cell(3, 'wallet', 'wallet', 0, 14, 2.5, 3.5, { cellGroup: 'wallets' }), cell(4, 'wallet', 'wallet', 2.5, 14, 2.5, 3.5, { cellGroup: 'wallets' }),
      cell(5, 'wallet', 'wallet', 5, 14, 2.5, 3.5, { cellGroup: 'wallets' }), cell(6, 'wallet', 'wallet', 7.5, 14, 2.5, 3.5, { cellGroup: 'wallets' })] },
  { code: '13x19_display', label: '13x19 sheet, one display print', paperWidthIn: 13, paperHeightIn: 19,
    cells: [cell(0, '11x14', 'display print', 1, 2.5, 11, 14, { sizeOptions: ['11x14', '12x18'] })] },
  { code: '13x19_11x14', label: '13x19 sheet, 11x14', paperWidthIn: 13, paperHeightIn: 19, cells: [cell(0, '11x14', '11x14', 1, 2.5, 11, 14)] },
  { code: '13x19_12x18', label: '13x19 sheet, 12x18', paperWidthIn: 13, paperHeightIn: 19, cells: [cell(0, '12x18', '12x18', 0.5, 0.5, 12, 18)] }
];

export interface SeedProduct { code: string; kind: 'package' | 'single'; name: string; description: string; priceCents: number; costCents: number | null; allowMultiPose: boolean; sheets: string[]; }

export const SEED_PRODUCTS: SeedProduct[] = [
  { code: 'pkg_mini', kind: 'package', name: 'Mini package', description: 'One 4x6 and four wallets.', priceCents: 1000, costCents: 100, allowMultiPose: true, sheets: ['4x6_single', '5x7_4up_wallet'] },
  { code: 'pkg_standard', kind: 'package', name: 'Standard package', description: 'One 8x10, one 5x7 and four wallets.', priceCents: 2000, costCents: 350, allowMultiPose: true, sheets: ['8x10_single', '8x10_5x7_4wallet'] },
  { code: 'pkg_deluxe', kind: 'package', name: 'Deluxe package', description: 'One 8x10, two 5x7 and four wallets. Mix poses at no extra cost.', priceCents: 3000, costCents: 400, allowMultiPose: true, sheets: ['13x19_composite'] },
  { code: 'pkg_display', kind: 'package', name: 'Display add-on', description: 'One large display print, your choice of 11x14 or 12x18.', priceCents: 2000, costCents: 400, allowMultiPose: false, sheets: ['13x19_display'] },
  { code: 'single_wallets', kind: 'single', name: 'Wallets (set of 4)', description: 'Four 2.5x3.5 wallets.', priceCents: 500, costCents: 60, allowMultiPose: true, sheets: ['5x7_4up_wallet'] },
  { code: 'single_mini_wallets', kind: 'single', name: 'Mini wallets (set of 4)', description: 'Four 2x3 mini wallets.', priceCents: 400, costCents: 40, allowMultiPose: true, sheets: ['4x6_4up_mini'] },
  { code: 'single_4x6', kind: 'single', name: '4x6 print', description: '', priceCents: 300, costCents: 40, allowMultiPose: false, sheets: ['4x6_single'] },
  { code: 'single_5x7', kind: 'single', name: '5x7 print', description: '', priceCents: 500, costCents: 60, allowMultiPose: false, sheets: ['5x7_single'] },
  { code: 'single_8x10', kind: 'single', name: '8x10 print', description: '', priceCents: 1000, costCents: 175, allowMultiPose: false, sheets: ['8x10_single'] },
  { code: 'single_11x14', kind: 'single', name: '11x14 print', description: '', priceCents: 1800, costCents: 400, allowMultiPose: false, sheets: ['13x19_11x14'] },
  { code: 'single_12x18', kind: 'single', name: '12x18 print', description: '', priceCents: 2000, costCents: 400, allowMultiPose: false, sheets: ['13x19_12x18'] }
];
