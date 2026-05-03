# App Client Guidelines

## Styling

Use `clsx` for all conditional or dynamic `className` values. Never use template strings or bare ternaries for class composition.

## Forms

All form text inputs must be submittable via the Enter key. Use `onSubmitEditing` on the last field to trigger submission, and `returnKeyType="go"` to label the action key appropriately. For multi-field forms, intermediate fields should use `returnKeyType="next"` and move focus to the next field on submit.

## Animations (react-native-reanimated)

- **Never use transform-based `entering`/`exiting` animations (Slide*, Stretch*) on flex children.** These animate `translateX`/`translateY` without affecting layout—the element occupies its full space immediately, causing a flash of its background before content visually arrives. Use `FadeIn`/`FadeOut` instead (opacity starts at 0, so no flash), or animate `width`/`height` via `useSharedValue` + `useAnimatedStyle` with `overflow: 'hidden'`.
- **Never nest `exiting` animations inside a parent that also has an exit animation.** The inner animation completes before the outer one finishes, causing flicker. Only the outermost container should define the exit transition; children should use `entering` only (or no animation).
