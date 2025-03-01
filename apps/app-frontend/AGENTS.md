# App Frontend Guidelines

## Product Context

### Users

Ryot is a self-hosted personal tracking product for people who want to own and reflect on their data. The primary design target is the quantified-self user, with strong overlap from privacy-conscious self-hosters and enthusiasts tracking media, fitness, and custom life facets.

Users are typically managing Ryot in the context of their own routines: logging activity, reviewing progress, browsing their personal library, and shaping custom trackers around what matters to them. Their core job to be done is to capture meaningful life data in one place they control, then revisit it in a way that supports reflection, pattern recognition, and steady personal insight.

### Brand Personality

Ryot should feel warm, calm, and confident. Its voice should be personal, trustworthy, and quietly premium rather than loud, hype-driven, or overly playful.

Emotionally, the interface should create a sense of ownership, clarity, and composure. It can include small moments of delight, but the dominant feeling should be that of a well-made personal tool the user can settle into for years.

### Aesthetic Direction

The visual direction is notebook editorial: a personal journal for tracking, not a generic SaaS dashboard. Existing product signals already support this direction and should be preserved: Space Grotesk for headings, Outfit for body copy, IBM Plex Mono for technical values, warm gold accent tones, and warm stone neutrals in both light and dark themes.

Light and dark mode should both be supported. Dark mode should stay warm and stone-based rather than blue-tinted; light mode should use warm off-whites rather than sterile pure white. Facet colors can differentiate domains, but the overall system should remain restrained and cohesive.

Anti-direction: do not make Ryot feel like a cold enterprise dashboard, a social feed, or a flashy consumer app built around novelty effects. Avoid generic productivity-tool aesthetics when they conflict with the journal-like identity.

### Design Principles

1. Make every screen feel like a crafted personal journal, not a generic SaaS control panel.
2. Optimize for calm information density: compact, scannable, and reflective without feeling cramped.
3. Use warmth and restraint in typography, color, and motion; accents should guide, not dominate.
4. Preserve the platform nature of Ryot: designs must work whether a user tracks one facet or many.
5. Treat accessibility as a baseline quality bar; future UI work should meet WCAG AA.

## Engineering Guardrails

### Type Safety

- Do not manually duplicate API request or response shapes that already exist in `src/lib/api/openapi.d.ts`.
- When frontend code needs API types, derive them from the generated OpenAPI types, preferably through shared helpers in `src/lib/api/types.ts`.
- Treat hand-written API model interfaces as a last resort only when the frontend intentionally needs a transformed view-model that differs from the wire format.
- When a zod schema exists, derive the TypeScript type from the schema with `z.infer` instead of maintaining a parallel manually typed interface.
- If a helper accepts partially built form data before schema normalization, keep that as a distinct input type and name it to reflect that purpose.
- Before adding a new type alias or interface in `apps/app-frontend`, check whether it can be expressed as `z.infer`, `ReturnType`, `Pick`, `Omit`, indexed access, or an OpenAPI-derived type first.
