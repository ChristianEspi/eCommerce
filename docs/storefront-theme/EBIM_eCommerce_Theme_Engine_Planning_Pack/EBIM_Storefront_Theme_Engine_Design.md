# Storefront Theme Engine Design

**Date:** 2026-09-10

## Goal

Evolve the existing EBIM eCommerce storefront into a configurable, attractive, multi-industry SaaS storefront without duplicating business logic or creating separate applications per business vertical.

The same storefront codebase must serve fashion, footwear, pharmacy, drugstores, groceries, electronics, home, hardware, distributors, and future retail verticals by combining tenant branding, one of four theme presets, controlled layout options, and the existing CMS/catalog data.

## Current baseline observed in the provided repository

The repository already has the foundations required for the feature:

- React 18, TypeScript, Vite, MUI 6, React Query and Supabase.
- Public storefront under `/s/:storeSlug`.
- Tenant/store resolution through the public `public_stores` read model.
- `AppearanceProvider` and suite design tokens under `src/theme/`.
- Tenant branding through `store_settings`: accent color, logo, banner, favicon, font, radius, density, business display name and contact data.
- Existing public storefront components for hero, category navigation, products, promotions, brands, services, search, favorites, quick view, cart and checkout.
- Existing CMS with `hero`, `banner`, `carousel`, `product_collection`, `category_collection`, `rich_text`, `campaign` and `slider` blocks.
- Existing storefront tests and database tests.

The primary maintainability problem is concentration of visual decisions in large files, especially:

- `src/features/storefront/StoreHomePage.tsx`
- `src/features/storefront/StorefrontLayout.tsx`
- `src/features/storefront/components/ContentBlocks.tsx`

The feature must therefore extract composition and visual variants without rewriting commercial behavior.

## Product model

Storefront configuration is split into four orthogonal concerns.

### 1. Branding

Existing `store_settings` fields remain the source of truth for identity:

- `accent_color`
- `logo_url`
- `banner_url`
- `favicon_url`
- `font_family`
- `ui_radius`
- `ui_density`
- `business_display_name`
- existing contact and white-label fields

### 2. Theme preset

Add a closed list:

- `universal`
- `retail`
- `premium`
- `catalog`

`universal` is the backward-compatible default.

A theme changes presentation, density, hierarchy and component variants. It does not change pricing, inventory, promotions, checkout, tax, authentication or any other business rule.

### 3. Storefront style

A small, closed, validated configuration may override selected presentation variants, for example:

- header variant
- hero variant
- product-card variant
- category-card variant
- content width
- product image ratio
- section spacing

This configuration must not accept arbitrary CSS, HTML, JavaScript, URLs, executable code or unknown keys.

### 4. Home composition

The Home is composed from a controlled registry of known sections. V1 section IDs are:

- `hero`
- `services`
- `categories`
- `offers`
- `cms`
- `promotions`
- `best-sellers`
- `new-arrivals`
- `featured`
- `brands`
- `trust`
- `business-info`
- `newsletter`

The configuration controls order and enabled state. Optional `maxItems` is allowed only for sections that render collections and must have bounded values.

The CMS remains the owner of editorial content. The layout configuration must not duplicate CMS text, images, campaigns or product IDs.

## Architecture

### StorefrontThemeProvider

Create a storefront-specific provider layered inside the existing `AppearanceProvider`.

`AppearanceProvider` continues to own:

- light/dark appearance
- accent color
- tenant font
- radius
- density

`StorefrontThemeProvider` owns:

- theme preset resolution
- default visual variants
- validated per-store overrides
- storefront CSS/data attributes
- read-only theme context consumed by storefront components

The provider must expose a small typed interface. Components must not compare theme names directly wherever possible; they consume resolved variants/tokens.

### Theme definitions

Create a closed registry of `ThemeDefinition` objects. Each preset provides values such as:

- `headerVariant`
- `heroVariant`
- `productCardVariant`
- `categoryVariant`
- `contentWidth`
- `imageRatio`
- `sectionSpacing`
- `gridColumns`
- other strictly presentational defaults that are justified by existing components

Do not create four copies of `StoreHomePage`, `ProductCard`, `StorefrontLayout` or checkout components.

### HomeComposer and SectionRegistry

Extract the Home ordering logic from `StoreHomePage` into a composer.

The composer receives already-resolved data and a normalized home layout, then renders known section adapters in order. Each section adapter has one clear responsibility and reuses current components/data.

Unknown, malformed or unavailable sections must fail closed: ignore the invalid entry and keep the rest of the storefront usable. A store with no new configuration must render the existing experience through the `universal` defaults.

### CSS strategy

Reuse `src/features/storefront/storefront.css` and the existing `.sf-scope` boundary. Theme-specific differences should be expressed through CSS custom properties and stable data attributes such as `data-store-theme`, not through global style leakage.

The backoffice must not visually change when storefront themes are introduced.

## Preset intent

### Universal

Balanced, neutral and modern. Default for existing and new stores that have not selected a theme. Suitable for most retail businesses.

### Retail

Commercial and promotion-forward. Categories, prices, discounts, quick-add and promotional modules are visually prominent. Suitable for pharmacy, drugstores, groceries, beauty and high-frequency retail.

### Premium

Editorial and spacious. Larger media, reduced visual noise, elegant hierarchy and more whitespace. Suitable for fashion, footwear, jewelry, cosmetics, furniture and premium brands.

### Catalog

Dense and discovery-oriented. Search, category navigation, filters, SKU/presentation context when data exists, compact cards and higher product density are prioritized. Suitable for distributors, hardware, spare parts, technology and large catalogs.

## Data model

Extend `public.store_settings` in a new immutable migration. Do not edit an applied migration.

Recommended fields:

- `theme_preset text not null default 'universal'`
- `storefront_style jsonb not null default '{}'::jsonb`
- `home_layout jsonb not null` with a safe V1 default

Database constraints/functions must reject unknown theme names and unsafe/malformed JSON shapes. The application must also validate them with Zod and fall back to safe defaults if a stale or unexpected public response is encountered.

The new public fields are presentational and may be exposed to `anon` through the same controlled `public_stores` read model. They must not expose organization/company identifiers or internal configuration.

Existing authenticated update permissions should be extended only for these presentational fields. Preserve RLS and role checks.

## Administration

Add a storefront-design area to the existing settings experience rather than a separate administration application.

The admin must support:

- select one of the four presets
- retain existing logo/color/font/radius/density controls
- enable/disable Home sections
- reorder Home sections accessibly
- reset layout/style to preset defaults
- preview Desktop / Tablet / Mobile

V1 does not need a fully free-form drag-and-drop page builder. Accessible up/down controls are acceptable and should be the fallback even if pointer drag-and-drop is later added.

## Preview

Preview must use the same theme definitions and normalization logic as the public storefront. Do not build a second mock implementation that can diverge from production behavior.

A preview may use real store data already available to the admin. It must not bypass RLS or introduce service-role credentials in the browser.

## Existing logic that must not regress

Theme work is not authorization to change business behavior. Preserve, unless a failing test proves a necessary compatibility adaptation:

- public store resolution by slug
- anonymous catalog reads
- RLS and grants
- pricing and B2B pricing
- discounts and promotions
- taxes
- inventory and availability
- product variants
- favorites
- search and cancellation/debounce behavior
- cart ownership and persistence
- quick view semantics
- checkout
- payments
- order creation/status
- account requirements
- content capability fallback behavior
- SEO and noindex behavior
- accessibility behavior already covered by tests
- analytics events
- URLs and route contracts

## Backward compatibility

This is a hard requirement.

For any store created before the migration, or any public response missing the new fields during a rolling deployment:

- theme resolves to `universal`
- style resolves to the preset defaults
- home layout resolves to the legacy-equivalent default order
- storefront remains usable

The deployment order of DB and frontend must not create a blank storefront.

## Testing strategy

Every implementation phase must use test-driven changes where practical and end with relevant focused tests plus the repository quality gates.

Global gates:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Database-changing phases also run:

```bash
npm run test:db
npm run db:types
```

Visual phases add Playwright/component coverage for Desktop, Tablet and Mobile. Tests must verify behavior and semantics rather than snapshotting huge DOM trees.

## Multi-industry acceptance scenarios

Use the same application code to prove four configurations:

1. Fashion/apparel -> `premium`
2. Footwear/general retail -> `universal`
3. Pharmacy/drugstore -> `retail`
4. Grocery/distributor/large catalog -> `catalog`

No business vertical may be detected through hard-coded rules such as `if pharmacy`. Differences must come from theme/layout configuration and catalog/content data.

## Performance and accessibility

Preserve current reduced-motion handling, keyboard semantics, focus management, link/button correctness and accessible names.

Avoid loading all theme-specific media or duplicate component trees. Theme switching is configuration, not four applications bundled together.

Home sections should not introduce unnecessary network requests. Reuse existing query results where possible and keep current React Query caching behavior.

## Non-goals for V1

- arbitrary tenant CSS
- arbitrary tenant HTML/JavaScript
- third-party theme marketplace
- user-authored React components
- per-vertical business logic
- a complete Elementor/Webflow-style page builder
- rewriting checkout or product-domain logic
- migrating the entire MUI/design system

## Definition of done

The feature is complete when an authorized store administrator can choose a preset, configure/reorder allowed Home sections, preview the result at common viewport classes, save the settings, and see the same configuration on the public storefront; existing stores continue to render through `universal`; the four multi-industry acceptance scenarios look intentionally different without code forks; and all quality/security gates pass.
