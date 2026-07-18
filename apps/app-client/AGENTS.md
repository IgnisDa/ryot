# App Client Guidelines

Ryot is a self-hosted personal tracker. Keep the UI warm, calm, compact, scannable, WCAG AA compliant, and free of generic SaaS/social-feed aesthetics or novelty motion.

- Use `clsx` for conditional/dynamic `className`. Never template strings or bare ternaries.
- Prefer Tailwind responsive variants (`sm:`, `md:`, `lg:`) and CSS utilities over JS layout (`useWindowDimensions`, `onLayout`, manual pixel math). Fall back to JS only when layout depends on runtime data.
- Prefer `className` for static layout, spacing, sizing, opacity, borders, and colors. Use inline `style` only for dynamic runtime values, safe-area insets, animation output, or native-only props that Tailwind cannot express.
- Use a single `props` parameter, not destructured arguments.
- Use the shared API/query hooks and client wrappers for fetching; avoid raw `fetch` and `useEffect` for loading data.
- Keep route and navigation logic in the existing Expo Router and navigation helpers.
- All text inputs must be submittable via Enter. Last field: `onSubmitEditing` + `returnKeyType="go"`. Intermediate fields: `returnKeyType="next"` with focus forwarding.
