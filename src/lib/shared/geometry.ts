import type { SheetCell, SheetTemplate } from './catalog';

/** Cell rectangle in percent of the paper, for CSS/SVG rendering. */
export function cellPercent(cell: { xIn: number; yIn: number; wIn: number; hIn: number }, sheet: { paperWidthIn: number; paperHeightIn: number }) {
  return {
    left: (cell.xIn / sheet.paperWidthIn) * 100,
    top: (cell.yIn / sheet.paperHeightIn) * 100,
    width: (cell.wIn / sheet.paperWidthIn) * 100,
    height: (cell.hIn / sheet.paperHeightIn) * 100
  };
}

/** Geometry for a display cell after the parent chose a size: centre the chosen print on the paper. */
export function resolveCellGeometry(cell: SheetCell, sheet: SheetTemplate, sizeChoice: string | null | undefined, sizes: { code: string; widthIn: number; heightIn: number }[]) {
  if (!cell.sizeOptions?.length || !sizeChoice) return { xIn: cell.xIn, yIn: cell.yIn, wIn: cell.wIn, hIn: cell.hIn };
  const size = sizes.find((s) => s.code === sizeChoice);
  if (!size) return { xIn: cell.xIn, yIn: cell.yIn, wIn: cell.wIn, hIn: cell.hIn };
  const w = Math.min(size.widthIn, sheet.paperWidthIn);
  const h = Math.min(size.heightIn, sheet.paperHeightIn);
  return { xIn: (sheet.paperWidthIn - w) / 2, yIn: (sheet.paperHeightIn - h) / 2, wIn: w, hIn: h };
}

/** Suggested photo orientation in the physical cell (whose dimensions already include sheet rotation).
 * Preview only: does not alter the source file, ordered size, or final Lightroom crop.
 */
export function fitPhotoToCell(photoW: number, photoH: number, cellW: number, cellH: number): { rotation: 0 | 90; cropLoss: number } | null {
  if (![photoW, photoH, cellW, cellH].every(n => Number.isFinite(n) && n > 0)) return null;
  const pa = photoW / photoH, ca = cellW / cellH;
  const loss = (aspect: number) => 1 - Math.min(aspect / ca, ca / aspect);
  const upright = loss(pa), turned = loss(1 / pa);
  // Preserve upright orientation for square photos/cells and other equal fits.
  return turned < upright - 1e-12 ? { rotation: 90, cropLoss: turned } : { rotation: 0, cropLoss: upright };
}

/** Warn only about cropping still needed after choosing the better quarter-turn orientation. */
export function cropLossExceeds(photoW: number, photoH: number, cellW: number, cellH: number, threshold = 0.2): boolean {
  return (fitPhotoToCell(photoW, photoH, cellW, cellH)?.cropLoss ?? 0) > threshold + 1e-12;
}

/** Validate that no cell leaves the paper and no two cells overlap (used by the catalog CI test and admin import). */
export function validateSheet(sheet: SheetTemplate): string[] {
  const errors: string[] = [];
  const eps = 1e-6;
  sheet.cells.forEach((c, i) => {
    if (c.xIn < -eps || c.yIn < -eps || c.xIn + c.wIn > sheet.paperWidthIn + eps || c.yIn + c.hIn > sheet.paperHeightIn + eps)
      errors.push(`${sheet.code} cell ${i} (${c.label}) leaves the paper`);
    for (let j = i + 1; j < sheet.cells.length; j++) {
      const d = sheet.cells[j];
      const overlap = c.xIn < d.xIn + d.wIn - eps && d.xIn < c.xIn + c.wIn - eps && c.yIn < d.yIn + d.hIn - eps && d.yIn < c.yIn + c.hIn - eps;
      if (overlap) errors.push(`${sheet.code} cells ${i} and ${j} overlap`);
    }
  });
  return errors;
}
