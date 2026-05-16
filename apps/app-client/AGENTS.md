# App Client Guidelines

Ryot is a self-hosted personal tracker. Keep the UI warm, calm, compact, scannable, WCAG AA compliant, and free of generic SaaS/social-feed aesthetics or novelty motion.

## Styling

- Use `clsx` for conditional/dynamic `className`. Never template strings or bare ternaries.
- Prefer Tailwind responsive variants (`sm:`, `md:`, `lg:`) and CSS utilities over JS layout (`useWindowDimensions`, `onLayout`, manual pixel math). Fall back to JS only when layout depends on runtime data.
- Prefer `className` for static layout, spacing, sizing, opacity, borders, and colors. Use inline `style` only for dynamic runtime values, safe-area insets, animation output, or native-only props that Tailwind cannot express.

## Type Safety

- Prefer derived or canonical backend/generated types over handwritten mirrors, local aliases, and duplicate shared shapes.

## Components

- Use a single `props` parameter, not destructured arguments.

## Routing And Data Loading

- Use the shared API/query hooks and client wrappers for fetching; avoid raw `fetch` and `useEffect` for loading data.
- Keep route and navigation logic in the existing Expo Router and navigation helpers.

## Forms

- All text inputs must be submittable via Enter. Last field: `onSubmitEditing` + `returnKeyType="go"`. Intermediate fields: `returnKeyType="next"` with focus forwarding.

## Animations (react-native-reanimated)

- **No transform-based entering/exiting (Slide*, Stretch*) on flex children.** They don't affect layout — element occupies full space immediately, causing a flash. Use `FadeIn`/`FadeOut`, or animate `width`/`height` via `useSharedValue` + `useAnimatedStyle` with `overflow: 'hidden'`.
- **No nested `exiting` animations.** Only the outermost container defines exit; children use `entering` only.

## State Management

- Never consume Jotai atoms directly (`useAtomValue`/`useSetAtom`). Use hooks from `@/lib/atoms` and `@/lib/navigation`.
- Atoms stay private to their defining file. Expose via colocated hooks, never export the atom.

## Tests

- Share fixtures by ownership, not as one generic file.
