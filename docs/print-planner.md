# Optional print package planner

Open **Catalog → Explore paper layouts** beside an offering, or expand **Internal layout reference → Explore this print mix**. The planner is an optional studio tool at `/admin/catalog/planner`, not a required step for pricing, checkout or fulfillment.

## Purpose

Explore which print quantities and paper sizes make a practical package before recreating the chosen arrangement in Lightroom Classic. Existing offerings and reference templates seed the *contents*, not the physical production layout. An offering with size choices starts with its default size; change quantities explicitly to explore the alternative.

The planner does not edit catalog data, templates, prices, orders or print jobs. It has no write endpoint or schema changes. Experiments are temporary and reset when the page is reloaded. It works in the read-only demo, while ordinary studio access remains authenticated.

## Inputs and suggestions

- Print counts for existing catalog sizes, up to 60 prints in one exploration.
- Paper presets: 4×6, 5×7, 8×10, Letter, A4, A3, and A3+; custom dimensions up to 2,000 mm per side.
- Independent top/right/bottom/left margins, minimum white cutting space, sheet orientation and optional print rotation.
- Inches or millimetres. The calculation stores integer micrometres; changing display units does not change geometry.
- Up to four distinct full-package arrangements, with sheet count and finished-print area divided by total paper area.
- A same-settings comparison across paper sizes. Each suggestion uses one stock size throughout; mixed-stock and batch nesting are outside this version.

The A3+ profile uses **329×483 mm**, not 13×19 inches. A genuinely 13×19-inch stock can be entered as custom paper after checking its specification. Paper dimensions are not a printer's usable area. Default quarter-inch margins and eighth-inch gaps are editable planning assumptions, not verified printer settings. [Canon's paper-size table](https://ij.manual.canon/ij/webmanual/Manual/All/TA-30/EN/LBGA/lbga_tp000146.html) documents the A3+ dimensions.

Suggestions never reduce finished print dimensions, drop quantities or claim a proof of optimal packing. If any individual print exceeds the entered usable area, no partial-package plan is offered. Zero gaps mean shared-edge cuts; zero margins can require borderless operation and a separate check of driver expansion. White cutting space is not bleed. Physical output remains unverified until the photographer checks the actual stock, driver, scale and a test print.

## Lightroom handoff

Select a layout and sheet; select a print to see its X/Y position and placed width/height. The placement table and text download contain every sheet, exact units, physical-sheet top-left coordinates and 0°/90° orientation. Copy uses the browser clipboard when available and offers a download fallback.

Recreate the cells in **Lightroom Classic → Print → Custom Package**, check crops and print settings, then save a User Template. The download is a **manual reference**, not an importable `.lrtemplate`, production image or automatically calibrated print file. [Adobe's layout documentation](https://helpx.adobe.com/lightroom-classic/desktop/print-photos/print-module-layouts-templates.html) describes Custom Package and reusable templates.

## Implementation and checks

`src/lib/shared/print-planner.ts` performs a bounded, deterministic multi-start rectangle search: different size orders, per-size rotation preferences for up to four size groups, and tight/row-first placement scores. Every reserved rectangle includes right/bottom cut spacing, with an extra outer allowance so a cut gap is not mistakenly required beyond the usable sheet edge. Suggestions rank by sheet count then occupied bounding area; those scores do not estimate cutting labor or prove a global optimum.

Independent geometry tests check all quantities, exact finished dimensions, paper bounds, pairwise gaps, asymmetric margins, rotation-off behavior, invalid inputs, oversized prints, repeated source sheets and the A3+ mixed-package regression. Browser verification covers the entry links, controls, selection, units, multi-sheet navigation, handoff, responsive layout and unchanged database content.

Keep future investment bounded: consider saved explorations, per-stock costs, and mixed-stock comparison only after real package-planning use shows their value. Photo editing, arbitrary drag-and-drop design and automatic Lightroom template export are separate projects, not assumptions of this tool.
