# UI Responsive Layout Pass

## Goal

Align the app UI to a desktop reference layout (13" MacBook Air baseline) while ensuring all major pages remain usable on:

- Mobile widths (small phones through large phones)
- Tablet widths
- Large desktop and high-resolution displays

This pass is strictly presentational and must not change feature behavior, API calls, or business logic.

## Problems Observed

- Desktop-first headers and section wrappers used fixed negative margins and large fixed typography.
- Several page toolbars forced single-row horizontal layouts, causing overflow on mobile.
- Multiple forms used fixed `grid-cols-2` / `grid-cols-3` without mobile fallbacks.
- Some footer summary/action bars were designed for wide desktops and clipped on narrow screens.
- Data table pagination controls had rigid spacing that overflowed on small widths.

## Responsive Strategy

1. **Shared primitives first**
   - Make `PageHeader`, `PageSection`, and `PageSectionDivider` responsive by default.
   - Make table toolbar/search/pagination patterns wrap and stack on small screens.

2. **App shell improvements**
   - Keep desktop baseline visual density similar to current behavior.
   - Add a bounded max-width content container for high-resolution displays.
   - Preserve current sidebar behavior and token-scoped navigation.

3. **Page-level fixes**
   - Convert fixed grids to mobile-first (`grid-cols-1` + breakpoint upgrades).
   - Replace fixed large text sizes with responsive scales.
   - Ensure action bars and summary rows wrap cleanly.
   - Keep dialogs scrollable and width-constrained on mobile.

## Non-goals

- No changes to tRPC procedures, services, schemas, or database logic.
- No workflow/interaction logic changes.
- No backend behavior changes.

## Verification Approach

- Run lint after UI class updates.
- Manually verify key routes render without horizontal overflow:
  - Launch
  - Wallet list + wallet detail
  - Holdings / Transactions pages with tables
  - Volume Bot creation + session detail
  - Account + Subscription
