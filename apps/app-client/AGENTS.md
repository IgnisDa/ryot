# App Client Guidelines

## Product Context

- Ryot is a self-hosted personal tracker. The UI should feel like a crafted personal journal: warm, calm, and confident, not a generic SaaS dashboard.
- Keep it compact and scannable; maintain WCAG AA.
- Avoid cold enterprise dashboards, social-feed aesthetics, and novelty motion.

## Styling

- Use `clsx` for conditional/dynamic `className`. Never template strings or bare ternaries.
- Prefer Tailwind responsive variants (`sm:`, `md:`, `lg:`) and CSS utilities over JS layout (`useWindowDimensions`, `onLayout`, manual pixel math). Fall back to JS only when layout depends on runtime data.

## Type Safety

- Prefer derived types (`ReturnType`, indexed access types, `z.infer`) and canonical imported backend/generated types over handwritten mirrors.
- If multiple client files need the same shape, export it from one module and reuse it.
- Avoid local aliases that only re-declare OpenAPI/backend shapes.

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
