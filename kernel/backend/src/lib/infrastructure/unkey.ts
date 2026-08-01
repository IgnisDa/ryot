// The dotted `process.env.UNKEY_ROOT_KEY` form is required verbatim: the build script's
// `bun build --define process.env.UNKEY_ROOT_KEY=...` textually replaces this exact member
// expression, and bracket access would not match, breaking build-time inlining.
// @ts-expect-error -- noPropertyAccessFromIndexSignature forbids dot access; see comment above.
export const UNKEY_ROOT_KEY = process.env.UNKEY_ROOT_KEY ?? "";
