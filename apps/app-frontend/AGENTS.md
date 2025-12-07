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

- Derive API types from `@ryot/generated/openapi/app-backend` via helpers in `src/lib/api/types.ts`. Do not duplicate wire shapes manually.
- Derive TypeScript types from zod schemas with `z.infer` instead of parallel interfaces.
- Before adding a new type, check if `z.infer`, `ReturnType`, `Pick`, `Omit`, indexed access, or an OpenAPI-derived type covers it first.

### Styling

- **Prefer Mantine props over inline styles**: Use props like `c`, `bg`, `ff`, `fw`, `lh`, `ta`, `tt`, `maw`, `miw`, `pt`, `mt`, etc. instead of `style={{}}` where direct equivalents exist.
- **Keep inline styles for**: Properties without Mantine props (`flex`, `overflow`, `letterSpacing`, `whiteSpace`, gradients, complex borders, transitions).
- **Typography**: Use `ff="var(--mantine-headings-font-family)"` for headings, never hardcode font names.
- **Non-Mantine components**: Use inline styles for components from other libraries (e.g., TanStack Router `Link`).
