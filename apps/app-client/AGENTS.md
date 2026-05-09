# App Client Guidelines

## Forms

All form text inputs must be submittable via the Enter key. Use `onSubmitEditing` on the last field to trigger submission, and `returnKeyType="go"` to label the action key appropriately. For multi-field forms, intermediate fields should use `returnKeyType="next"` and move focus to the next field on submit.

## Animations (react-native-reanimated)

- **Never use `entering`/`exiting` layout animations on flex children.** `SlideInRight` and similar transforms don't affect layout—the element occupies its full space immediately, causing a flash of its background before content visually arrives. Instead, animate `width` (or `height`) via `useSharedValue` + `useAnimatedStyle` with `overflow: 'hidden'` so the element grows/shrinks smoothly within the flex layout.
- **Never nest `exiting` animations inside a parent that also has an exit animation.** The inner animation completes before the outer one finishes, causing flicker. Only the outermost container should define the exit transition; children should use `entering` only (or no animation).
- **Prefer always-mounted components with animated style for panels in flex layouts.** Instead of `{open && <Panel />}` with `entering`/`exiting`, keep the component mounted and drive visibility through an animated width/height shared value. This avoids lifecycle races between React unmounting and reanimated's exit animation mechanism, especially on web.
