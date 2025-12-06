# App Frontend Guidelines

## Product Context

Ryot is a self-hosted personal tracker for people who want to own and reflect on their data. The UI should feel like a crafted personal journal — warm, calm, and confident — not a generic SaaS dashboard or flashy consumer app.

- **Typography**: Space Grotesk (headings), Outfit (body), IBM Plex Mono (technical values)
- **Colors**: Warm gold accents, warm stone neutrals. Dark mode: warm/stone-based, not blue-tinted. Light mode: warm off-whites, not sterile white
- **Density**: Compact and scannable; optimize for calm information density, not cramped. Accessibility baseline: WCAG AA
- **Platform nature**: Designs must work whether a user tracks one thing or many
- **Anti-patterns**: Avoid cold enterprise dashboards, social-feed aesthetics, novelty motion effects, and generic productivity-tool chrome

## Engineering Guardrails

### Type Safety

- Derive API types from `src/lib/api/openapi.d.ts` via helpers in `src/lib/api/types.ts`. Do not duplicate wire shapes manually.
- Derive TypeScript types from zod schemas with `z.infer` instead of parallel interfaces.
- Before adding a new type, check if `z.infer`, `ReturnType`, `Pick`, `Omit`, indexed access, or an OpenAPI-derived type covers it first.
