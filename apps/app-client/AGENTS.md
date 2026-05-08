# App Client Guidelines

## Styling

- Use `clsx` for conditional/dynamic `className`. Never template strings or bare ternaries.
- Prefer Tailwind responsive variants (`sm:`, `md:`, `lg:`) and CSS utilities over JS layout (`useWindowDimensions`, `onLayout`, manual pixel math). Fall back to JS only when layout depends on runtime data.

## Forms

- All text inputs must be submittable via Enter. Last field: `onSubmitEditing` + `returnKeyType="go"`. Intermediate fields: `returnKeyType="next"` with focus forwarding.

## Animations (react-native-reanimated)

- **No transform-based entering/exiting (Slide*, Stretch*) on flex children.** They don't affect layout — element occupies full space immediately, causing a flash. Use `FadeIn`/`FadeOut`, or animate `width`/`height` via `useSharedValue` + `useAnimatedStyle` with `overflow: 'hidden'`.
- **No nested `exiting` animations.** Only the outermost container defines exit; children use `entering` only.

## State Management

- Never consume Jotai atoms directly (`useAtomValue`/`useSetAtom`). Use hooks from `@/lib/atoms` and `@/lib/navigation`.
- Atoms stay private to their defining file. Expose via colocated hooks, never export the atom.
