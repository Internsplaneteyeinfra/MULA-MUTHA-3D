# MARGIN BOARD FULL STATUS-COLOUR CARD DESIGN

**Project:** MULA-MUTHA-3D / RIVER.EYE  
**Date:** 2026-11-25  
**Scope:** Margin Board card chrome only — LIVE/HISTORIC data paths and Phase 8 locks unchanged.

## Verdict

Every Margin Board card is now **fully filled** with its NadiTwin flood-risk status colour (red / orange / yellow / green). Dark interiors with border-only accents are gone. Text uses white headings/values and lighter white labels for contrast. **MODELLED / PROVISIONAL** disclaimer and Phase 8 **LOCKED** messaging remain.

Validation: `scratch/margin_board_colour_validation.json` → **pass: true**

Screenshots: `scratch/screenshots/margin-board-full-colours/`

---

## 1. Colour specification (applied)

| Status | Card background | Border | Status badge |
|--------|-----------------|--------|--------------|
| **DANGER** | `#B3262D` (+ subtle depth gradient) | `#FF6268` | Pale pink `#ffd6d9` / dark red text |
| **WARNING** | `#D96B16` | `#FFAA45` | Pale orange `#ffe4c2` / dark orange text |
| **WATCH** | `#C99A16` | `#F5CD48` | Pale yellow `#fff3c4` / dark text |
| **SAFE** | `#238044` | `#56C77A` | Pale green `#c8f0d6` / dark green text |
| **UNVERIFIED** (missing/unknown) | Neutral grey `#3a4550` | `#8a969f` | Explicit **UNVERIFIED** badge |

Status colour is driven only by NadiTwin `status` (`data-status`). No reclassification from colour.

---

## 2. Text & fields

- Headings and metric values: white (`#ffffff`)
- Supporting labels: `rgba(255,255,255,0.82)`
- Font sizes unchanged
- All 16 metric fields preserved (margin, Q, stage, depth, danger, bank, Q@danger, 72 h peak Q, forecast peak stage, peak timing, exceedance, rain now/past/next, vulnerable CH, basis)
- Seven location cards retained

---

## 3. Responsive grid (unchanged breakpoints)

| Viewport | Columns |
|----------|---------|
| Wide (>1400 px) | 4 |
| Medium (≤1400 px) | 2 |
| Mobile (≤780 px) | 1 |

Equal card heights via CSS grid stretch + `height: 100%` on cards.

---

## 4. Disclaimer / Phase 8

Header strip remains:

> MODELLED / PROVISIONAL · Phase 8 safety boards remain LOCKED

Badge tooltip: `NadiTwin MODELLED / PROVISIONAL · Phase 8 LOCKED`.  
Full-colour cards do **not** imply independent engineering verification.

---

## 5. Files changed

| File | Change |
|------|--------|
| `src/ui/components/hydroIntelPanel.js` | Full-bleed status card CSS + white label/value contrast |
| `src/ui/components/hydroIntelMarginBoard.js` | Status → class mapping; **UNVERIFIED** when status missing |
| `scratch/capture_margin_board_full_colours.mjs` | Automated colour / field / open-close tests |

---

## 6. Source-status test coverage

| Colour | Source | Result |
|--------|--------|--------|
| Green SAFE | LIVE margins | 7/7 full green |
| Red DANGER | Historic `2024-07-15T06:00+05:30` | 7/7 full red |
| Yellow WATCH | Historic `2024-06-26T18:00+05:30` | Mixed SAFE/WATCH; WATCH full yellow |
| Orange WARNING | Historic `2024-07-06T00:00+05:30` | WARNING full orange |
| Grey UNVERIFIED | Explicit missing-status path | Neutral grey + UNVERIFIED badge |

Also verified: open/close/reopen, all fields present, white value contrast, LIVE three-graph stack intact after Margin Board use.

---

## 7. Screenshots

| File | Content |
|------|---------|
| `01-live-safe-green-cards.jpg` | LIVE — all SAFE green fills |
| `02-safe-card-detail.jpg` | Single SAFE card |
| `03-historic-danger-red-cards.jpg` | Historic DANGER red fills |
| `04-danger-card-detail.jpg` | Single DANGER card |
| `05-historic-watch-yellow-cards.jpg` | WATCH / SAFE mix |
| `06-watch-card-detail.jpg` | Single WATCH card |
| `07-historic-warning-orange-cards.jpg` | WARNING present |
| `08-warning-card-detail.jpg` | Single WARNING card |
| `09-unverified-grey-card.jpg` | UNVERIFIED grey |
| `10-responsive-1600x900.jpg` | Wide/medium layout |
| `11-responsive-780-mobile.jpg` | Single-column mobile |
