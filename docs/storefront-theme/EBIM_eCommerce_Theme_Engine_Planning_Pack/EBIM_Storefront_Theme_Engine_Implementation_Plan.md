# Storefront Theme Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable four-preset storefront Theme Engine for the existing EBIM eCommerce SaaS while preserving all business behavior and backward compatibility.

**Architecture:** Keep the current `AppearanceProvider` as the owner of tenant color/font/radius/density, add a storefront-only theme provider for resolved presentation variants, and extract Home composition into a typed section registry. Persist only safe closed-list presentation configuration in `store_settings` and expose it through the existing public read model.

**Tech Stack:** React 18, TypeScript 5.7, MUI 6, React Router 6, TanStack React Query 5, Zod 3, Supabase/PostgreSQL, Vitest, Testing Library, Playwright, Vite 6.

**Spec:** `docs/superpowers/specs/2026-09-10-storefront-theme-engine-design.md`

## Global Constraints

- Existing stores default to `universal` with a legacy-equivalent Home layout.
- Do not create separate storefront applications/pages for each theme.
- Do not change pricing, tax, inventory, promotions, variants, favorites, cart, checkout, payments, orders, RLS, tenant resolution or route behavior as part of visual work.
- Never accept arbitrary tenant CSS, HTML or JavaScript.
- Do not edit already-applied migrations; create a new migration strictly after the repository's latest migration.
- Public storefront still resolves the store by slug against the public read model and uses the anonymous client.
- Theme selection is base storefront configuration and is independent of the existing `content.white_label` entitlement.
- Reuse existing CMS content instead of duplicating editorial content in layout JSON.
- Preserve accessibility and reduced-motion behavior.
- End each phase with `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`; DB phases also run `npm run test:db` and regenerate DB types.

---

## File map

### New frontend theme files

- `src/features/storefront/theme/types.ts` — closed theme/style/layout types and Zod schemas.
- `src/features/storefront/theme/presets.ts` — four `ThemeDefinition` presets and default layout.
- `src/features/storefront/theme/normalize.ts` — safe fallback/merge functions for public DB values.
- `src/features/storefront/theme/theme-context.ts` — React context type only.
- `src/features/storefront/theme/StorefrontThemeProvider.tsx` — resolves preset/overrides and exposes theme context.
- `src/features/storefront/theme/useStorefrontTheme.ts` — context hook.
- `src/features/storefront/theme/theme.test.ts` — preset, normalization and provider tests.

### New Home composition files

- `src/features/storefront/home/types.ts` — section-rendering contracts.
- `src/features/storefront/home/SectionRegistry.tsx` — known section adapters only.
- `src/features/storefront/home/HomeComposer.tsx` — ordered rendering of normalized layout.
- `src/features/storefront/home/HomeComposer.test.tsx` — order, disabled/unknown/fallback tests.

### New admin files

- `src/features/admin/settings/StorefrontDesignSection.tsx` — preset and controlled storefront-style controls.
- `src/features/admin/settings/HomeLayoutEditor.tsx` — accessible order/enable controls.
- `src/features/admin/settings/StorefrontPreview.tsx` — preview shell using the same theme definitions.
- `src/features/admin/settings/storefront-design.test.tsx` — settings behavior tests.

### Existing files expected to change

- `src/features/storefront/types.ts`
- `src/features/storefront/api.ts`
- `src/features/storefront/StorefrontLayout.tsx`
- `src/features/storefront/StoreHomePage.tsx`
- `src/features/storefront/components/ProductCard.tsx`
- `src/features/storefront/components/ProductGrid.tsx`
- `src/features/storefront/components/StoreHero.tsx`
- `src/features/storefront/components/StoreFeaturedHero.tsx`
- `src/features/storefront/components/StoreCategoryNav.tsx`
- `src/features/storefront/components/CategoryBar.tsx`
- `src/features/storefront/components/SectionHeading.tsx`
- `src/features/storefront/storefront.css`
- `src/features/admin/SettingsPage.tsx`
- `src/features/admin/settings/types.ts`
- `src/features/admin/settings/api.ts`
- `src/features/admin/settings/useStoreSettings.ts` if query invalidation needs extension
- `src/shared/i18n/messages.es.ts`
- `src/shared/i18n/messages.en.ts`
- `src/shared/i18n/messages.test.ts` if key parity requires it
- `src/shared/lib/database.types.ts` generated, not hand-edited
- relevant storefront/admin tests
- `e2e/golden-path.e2e.ts` or a new focused storefront-theme E2E file

### Database

- Create one new migration after `20260910210000_ai_features.sql`, using the next available repository timestamp.
- Add focused DB tests such as `supabase/tests/storefront-theme.test.ts`.

---

### Task 1: Establish the real baseline and invariants

**Files:**
- Read: `CLAUDE.md`
- Read: `docs/STATE.md`
- Read: `docs/architecture.md`
- Read: `docs/VISUAL_QA_REPORT.md`
- Read: `src/features/storefront/StoreHomePage.tsx`
- Read: `src/features/storefront/StorefrontLayout.tsx`
- Read: `src/features/storefront/components/ContentBlocks.tsx`
- Read: `src/features/admin/SettingsPage.tsx`
- Create: `docs/storefront-theme/BASELINE.md`

**Interfaces:**
- Consumes: current repository only.
- Produces: a verified baseline and explicit no-regression inventory used by all later tasks.

- [ ] Run `npm ci` from the repository root.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `npm run test:db`; record exact pass/fail counts and pre-existing failures.
- [ ] Record the latest migration filename and current git status before changes.
- [ ] Document current Home section order, current public-store fields, current branding fields, current CMS block types and current theme/appearance ownership in `docs/storefront-theme/BASELINE.md`.
- [ ] Do not modify production code in this task.
- [ ] Commit only the baseline document if the repository is clean enough to do so.

### Task 2: Add typed storefront theme contracts with safe defaults

**Files:**
- Create: `src/features/storefront/theme/types.ts`
- Create: `src/features/storefront/theme/presets.ts`
- Create: `src/features/storefront/theme/normalize.ts`
- Create: `src/features/storefront/theme/theme.test.ts`

**Interfaces:**
- Produces:
  - `ThemePreset = 'universal' | 'retail' | 'premium' | 'catalog'`
  - `ThemeDefinition`
  - `StorefrontStyle`
  - `HomeSectionId`
  - `HomeSectionConfig`
  - `HomeLayout`
  - `DEFAULT_THEME_PRESET`
  - `DEFAULT_HOME_LAYOUT`
  - `THEME_PRESETS`
  - `normalizeThemePreset(value)`
  - `normalizeStorefrontStyle(value, preset)`
  - `normalizeHomeLayout(value)`

- [ ] Write tests proving an unknown preset becomes `universal`.
- [ ] Write tests proving unknown style keys and invalid variant values are discarded.
- [ ] Write tests proving malformed Home JSON becomes the legacy-equivalent default layout.
- [ ] Write tests proving duplicate Home sections are deduplicated and unknown IDs are ignored.
- [ ] Write tests proving `maxItems`, when present, is bounded to the defined safe range.
- [ ] Implement minimal Zod schemas and normalization to pass those tests.
- [ ] Define all four presets as data only; do not branch business logic by preset.
- [ ] Run focused theme tests and global frontend gates.
- [ ] Commit.

### Task 3: Persist safe theme configuration in Supabase

**Files:**
- Create: `supabase/migrations/<next_timestamp>_storefront_theme_engine.sql`
- Create: `supabase/tests/storefront-theme.test.ts`
- Modify generated: `src/shared/lib/database.types.ts`

**Interfaces:**
- Produces `store_settings.theme_preset`, `store_settings.storefront_style`, `store_settings.home_layout` and exposes them in `public.public_stores`.

- [ ] Write DB tests first for defaults, allowed presets, malformed JSON rejection, admin update authorization, tenant isolation and anonymous public read.
- [ ] Add `theme_preset text not null default 'universal'` with a closed CHECK.
- [ ] Add `storefront_style jsonb not null default '{}'::jsonb` with a CHECK/helper that accepts only known safe keys and closed values.
- [ ] Add `home_layout jsonb not null` with a versioned safe default and a CHECK/helper validating shape, section IDs, enabled booleans and bounded `maxItems`.
- [ ] Extend authenticated column UPDATE grants only for these three presentational fields while preserving current RLS policies.
- [ ] Extend anonymous column SELECT grants only as needed for the public view.
- [ ] Recreate `public.public_stores` in the new migration with the previous columns plus the three new fields; preserve `security_invoker = on` and active-store filtering.
- [ ] Do not expose organization/company IDs or internal `config`.
- [ ] Run `npm run test:db`.
- [ ] Run `npm run db:types`; never hand-edit generated DB types.
- [ ] Run global gates.
- [ ] Commit.

### Task 4: Carry configuration through public/admin typed APIs

**Files:**
- Modify: `src/features/storefront/types.ts`
- Modify: `src/features/storefront/api.ts`
- Modify: `src/features/admin/settings/types.ts`
- Modify: `src/features/admin/settings/api.ts`
- Modify: relevant storefront/settings tests

**Interfaces:**
- `PublicStore` gains normalized-compatible raw theme fields.
- `StoreSettings` and `StoreFormValues` gain theme/layout fields.
- Settings fetch/save select/patch the new fields.

- [ ] Write tests that old/missing public responses still parse and resolve to safe defaults.
- [ ] Write settings tests that an admin save includes the three fields and that they are independent of `canWhiteLabel`.
- [ ] Extend `publicStoreSchema` with catch/default behavior so rolling deploys cannot blank the storefront.
- [ ] Extend `STORE_SELECT` in `src/features/storefront/api.ts`.
- [ ] Extend settings schemas, `toForm`, selects and save patch.
- [ ] Keep raw DB JSON parsing separate from resolved presentation normalization.
- [ ] Run focused tests and global gates.
- [ ] Commit.

### Task 5: Introduce `StorefrontThemeProvider`

**Files:**
- Create: `src/features/storefront/theme/theme-context.ts`
- Create: `src/features/storefront/theme/StorefrontThemeProvider.tsx`
- Create: `src/features/storefront/theme/useStorefrontTheme.ts`
- Modify: `src/features/storefront/theme/theme.test.ts`
- Modify: `src/features/storefront/StorefrontLayout.tsx`

**Interfaces:**
- Produces a context containing resolved `preset`, `definition`, `style`, `homeLayout`.

- [ ] Write provider tests for default, each preset, safe overrides and malformed fallback.
- [ ] Mount the provider inside the resolved store branch and inside the existing `AppearanceProvider`/storefront scope.
- [ ] Apply stable `data-store-theme` and variant data attributes to `.sf-scope`.
- [ ] Do not alter cart/session/store resolution semantics.
- [ ] Verify backoffice tests remain unchanged.
- [ ] Run global gates.
- [ ] Commit.

### Task 6: Make the storefront shell theme-aware without forking it

**Files:**
- Modify: `src/features/storefront/StorefrontLayout.tsx`
- Modify: `src/features/storefront/storefront.css`
- Modify: storefront UI/a11y tests

**Interfaces:**
- Consumes `useStorefrontTheme()`.
- Produces theme-aware shell/header/container/footer styling while retaining one layout component.

- [ ] Add focused tests that all presets keep search, account, cart, category nav, skip link and public-page links reachable.
- [ ] Extract small header/footer subcomponents only where it materially reduces `StorefrontLayout.tsx` complexity.
- [ ] Express differences through resolved variants/CSS variables instead of `if theme === ...` blocks spread through JSX.
- [ ] Implement content-width and header-density differences for the four presets.
- [ ] Preserve current mobile navigation and assistant/cart layering.
- [ ] Run a11y/storefront tests and global gates.
- [ ] Commit.

### Task 7: Extract Home composition into a Section Registry

**Files:**
- Create: `src/features/storefront/home/types.ts`
- Create: `src/features/storefront/home/SectionRegistry.tsx`
- Create: `src/features/storefront/home/HomeComposer.tsx`
- Create: `src/features/storefront/home/HomeComposer.test.tsx`
- Modify: `src/features/storefront/StoreHomePage.tsx`

**Interfaces:**
- `HomeComposer` consumes normalized layout plus a typed `HomeSectionData` object built by `StoreHomePage`.
- Registry maps only known `HomeSectionId` values to adapters.

- [ ] Write tests for configured order, disabled sections, unknown section IDs, missing-data suppression and default order.
- [ ] Keep React Query hooks in `StoreHomePage`; do not move network ownership into every section adapter.
- [ ] Build one data object from existing query results and pass it to the composer.
- [ ] Move only rendering/order decisions out of `StoreHomePage`; preserve current catalog/search/filter state and hooks.
- [ ] Ensure the CMS hero still replaces the fallback `store_settings` hero according to current tests.
- [ ] Ensure catalog mode/query-parameter behavior remains independent of Home composition.
- [ ] Run storefront content/UI tests and global gates.
- [ ] Commit.

### Task 8: Implement the Universal preset as the compatibility baseline

**Files:**
- Modify: `src/features/storefront/theme/presets.ts`
- Modify: `src/features/storefront/storefront.css`
- Modify: existing storefront component tests as needed

**Interfaces:**
- Universal must reproduce current behavior closely enough that stores with no configuration do not experience a breaking redesign.

- [ ] Capture current behavior with tests before styling changes.
- [ ] Map current card, spacing, grid, hero and header choices into `universal` definition defaults.
- [ ] Remove accidental hard-coded presentation values only when they block the theme contract.
- [ ] Verify current stores render with no theme-specific data.
- [ ] Run global gates.
- [ ] Commit.

### Task 9: Add theme-aware product cards and product grids

**Files:**
- Modify: `src/features/storefront/components/ProductCard.tsx`
- Modify: `src/features/storefront/components/ProductGrid.tsx`
- Modify: `src/features/storefront/components/ProductCard.test.tsx`
- Modify: `src/features/storefront/storefront.css`

**Interfaces:**
- `ProductCard` consumes a resolved presentation variant, not a business vertical.
- `ProductGrid` consumes resolved grid columns/gap from the theme definition.

- [ ] Write tests proving add-to-cart, choose-options, favorite, quick-view, link semantics and pricing text are identical across card variants.
- [ ] Implement `standard`, `retail`, `editorial`, `compact` presentation variants or equivalent closed names.
- [ ] Universal uses standard; Retail emphasizes price/discount/quick-add; Premium uses editorial media/whitespace; Catalog uses compact density.
- [ ] Do not derive stock, discounts or price in the theme layer.
- [ ] Keep variant products from silently adding an arbitrary variant.
- [ ] Run focused tests and global gates.
- [ ] Commit.

### Task 10: Add theme-aware Hero, categories and section headings

**Files:**
- Modify: `src/features/storefront/components/StoreHero.tsx`
- Modify: `src/features/storefront/components/StoreFeaturedHero.tsx`
- Modify: `src/features/storefront/components/StoreCategoryNav.tsx`
- Modify: `src/features/storefront/components/CategoryBar.tsx`
- Modify: `src/features/storefront/components/SectionHeading.tsx`
- Modify: `src/features/storefront/storefront.css`
- Modify/add focused component tests

**Interfaces:**
- All components consume closed resolved variants.

- [ ] Add tests for semantic heading level, CTA href, keyboard navigation and fallback when images are absent.
- [ ] Implement balanced Universal hero, promotion-forward Retail hero, media-forward Premium hero and search/category-forward Catalog header/hero treatment.
- [ ] Categories support visual, tile and compact presentation without changing category data/querying.
- [ ] Section heading hierarchy remains consistent and accessible across variants.
- [ ] Run focused tests and global gates.
- [ ] Commit.

### Task 11: Finish Retail, Premium and Catalog preset styling

**Files:**
- Modify: `src/features/storefront/theme/presets.ts`
- Modify: `src/features/storefront/storefront.css`
- Modify: relevant component files only when a new closed variant is necessary
- Add: focused visual/behavior tests

**Interfaces:**
- Four complete presets using the same component graph.

- [ ] Retail: promotion and category prominence, commercial card density, strong price hierarchy.
- [ ] Premium: larger media, generous whitespace, restrained borders/shadows, editorial section spacing.
- [ ] Catalog: compact grid, stronger search/navigation hierarchy, reduced decorative surfaces.
- [ ] Verify no preset contains vertical detection or hard-coded pharmacy/fashion logic.
- [ ] Verify dark mode/reduced motion still work with each preset.
- [ ] Run global gates.
- [ ] Commit.

### Task 12: Add a complete business/footer trust layer

**Files:**
- Modify or split: `src/features/storefront/StorefrontLayout.tsx`
- Create if justified: `src/features/storefront/components/StoreFooter.tsx`
- Reuse: `src/features/storefront/components/BrandTrustStrip.tsx`
- Modify: storefront UI/a11y tests

**Interfaces:**
- Footer uses existing public store contact/business identity and existing navigation/content pages.

- [ ] Write tests that legal/content links remain reachable and contact fields are omitted cleanly when absent.
- [ ] Provide a polished footer suitable for any vertical: business identity, contact where present, public content/legal links, trust/service cues and copyright.
- [ ] Do not invent payment methods, delivery promises, social accounts or physical locations not present in data.
- [ ] Maintain white-label rules already present in the project.
- [ ] Run global gates.
- [ ] Commit.

### Task 13: Add Theme selection and controlled style settings to Admin

**Files:**
- Create: `src/features/admin/settings/StorefrontDesignSection.tsx`
- Modify: `src/features/admin/SettingsPage.tsx`
- Modify: `src/features/admin/settings/types.ts`
- Modify: `src/shared/i18n/messages.es.ts`
- Modify: `src/shared/i18n/messages.en.ts`
- Create/modify: `src/features/admin/settings/storefront-design.test.tsx`

**Interfaces:**
- Uses existing settings form/save mutation.
- Writes `theme_preset` and supported storefront-style overrides.

- [ ] Write admin tests for selecting each preset, reset to defaults, dirty-state behavior and save payload.
- [ ] Add a clearly named `Diseño de tienda` / `Store design` settings area/tab.
- [ ] Show four theme cards with concise purpose descriptions; do not encode a vertical restriction.
- [ ] Add only useful V1 style controls that map to closed contract values.
- [ ] Keep white-label capability gating exactly where it is; themes are not white-label premium.
- [ ] Run settings/i18n tests and global gates.
- [ ] Commit.

### Task 14: Add accessible Home layout editor

**Files:**
- Create: `src/features/admin/settings/HomeLayoutEditor.tsx`
- Modify: `src/features/admin/settings/StorefrontDesignSection.tsx`
- Modify: `src/features/admin/settings/storefront-design.test.tsx`
- Modify: i18n files

**Interfaces:**
- Reads/writes normalized `HomeLayout` in the existing settings form.

- [ ] Test enable/disable, move up, move down, reset, duplicate prevention and keyboard operability.
- [ ] Use accessible controls as the guaranteed interaction. Pointer drag-and-drop is optional and must not be the only path.
- [ ] Prevent disabling/removing structural behavior that would make catalog discovery impossible; the Home may hide sections, but header/search/catalog routes remain available.
- [ ] Store only IDs/state/order/maxItems, never CMS content.
- [ ] Run focused tests and global gates.
- [ ] Commit.

### Task 15: Add shared-code Desktop/Tablet/Mobile preview

**Files:**
- Create: `src/features/admin/settings/StorefrontPreview.tsx`
- Modify: `src/features/admin/settings/StorefrontDesignSection.tsx`
- Modify: admin tests

**Interfaces:**
- Preview consumes the exact theme registry/normalizers used by the public storefront.

- [ ] Write tests that preview selection changes viewport shell and that theme changes are reflected before save without changing public data.
- [ ] Render a constrained preview with Desktop/Tablet/Mobile frame choices.
- [ ] Reuse production presentation components or a deliberately thin adapter over them; do not hand-build a fake theme preview.
- [ ] Avoid new privileged data access. Use data already available through authorized admin hooks.
- [ ] Ensure preview controls are keyboard accessible.
- [ ] Run global gates.
- [ ] Commit.

### Task 16: Responsive, accessibility, SEO and performance hardening

**Files:**
- Modify: `src/features/storefront/storefront-a11y-seo.test.tsx`
- Modify/add: storefront UI tests
- Modify/add: Playwright theme E2E
- Modify: `docs/performance-budget.md` only if measured thresholds/contracts require documentation

**Interfaces:**
- Produces cross-theme non-regression evidence.

- [ ] Test 320/360-ish mobile, tablet and desktop layout classes without horizontal overflow.
- [ ] Verify skip link, focus order, heading hierarchy, link/button semantics, dialog/drawer focus and reduced-motion behavior.
- [ ] Verify title/meta/canonical/noindex behavior is unaffected by theme.
- [ ] Measure bundle impact with `npm run bundle:report`; do not duplicate four component trees or load theme-only heavy assets eagerly.
- [ ] Verify Home configuration does not multiply network requests for existing datasets.
- [ ] Run global gates.
- [ ] Commit.

### Task 17: Multi-industry acceptance fixtures and visual QA

**Files:**
- Create: `docs/storefront-theme/MULTI_INDUSTRY_QA.md`
- Add/modify: focused demo fixtures/scripts only if they do not contaminate production seed behavior
- Add: Playwright scenarios/screenshots under the repository's established convention

**Interfaces:**
- Proves one codebase can represent four business styles.

- [ ] Configure four acceptance stores/configurations: Fashion Premium, Footwear Universal, Pharmacy Retail, Large Catalog Catalog.
- [ ] Use configuration/data only; add a test that searches for forbidden vertical branching patterns in the theme layer if useful.
- [ ] Capture Desktop and Mobile evidence for each preset.
- [ ] Check empty states, no-logo, no-banner, no-CMS and no-discount variants.
- [ ] Record findings and any intentional differences in `MULTI_INDUSTRY_QA.md`.
- [ ] Run global gates.
- [ ] Commit.

### Task 18: Full regression/security hardening

**Files:**
- Modify only files required by failures discovered in this task.
- Create: `docs/storefront-theme/REGRESSION_REPORT.md`

**Interfaces:**
- Produces release-candidate evidence.

- [ ] Run all frontend tests, all DB tests, typecheck, lint, build, secret scan and available E2E/golden-path flows.
- [ ] Specifically exercise guest and authenticated cart, product with variants, promotions/discounts, B2B price path, account-required checkout, payment-related checkout path and order tracking.
- [ ] Verify RLS/anon public read does not expose additional internal fields beyond the three presentational fields.
- [ ] Fix regressions with the smallest scoped change and add a test for each bug found.
- [ ] Record exact results in `REGRESSION_REPORT.md`.
- [ ] Commit.

### Task 19: Final cleanup, documentation and release decision

**Files:**
- Create: `docs/storefront-theme/FINAL_REPORT.md`
- Modify: architecture/state docs only where the repository convention requires it.

**Interfaces:**
- Produces final GO / GO_WITH_GAPS / NO_GO decision and operator notes.

- [ ] Remove dead experimental code, console logs and unused theme branches.
- [ ] Confirm no applied migration was edited.
- [ ] Confirm generated DB types match migrations.
- [ ] Confirm default old-store behavior remains `universal`.
- [ ] Re-run the full quality gate twice if the first pass required any fix.
- [ ] Document final test counts, changed migration, theme contracts, admin workflow, rollback considerations and known gaps.
- [ ] Declare GO only if there are no P0/P1 regressions and storefront core flows are green.
- [ ] Commit final documentation.
